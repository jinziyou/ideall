import { engineRegistry } from "@/engines/builtin"
import { ideallRootFileSystem } from "@/filesystem/builtin"
import { mountFileSystem } from "@/filesystem/composite-root"
import { fileSystemRegistry } from "@/filesystem/registry"
import { registerFileEngineContribution } from "@/workspace/file-engine-registration"
import { fileEngineRendererRegistry } from "@/workspace/file-engine-renderer"
import type {
  RuntimeExtensionContribution,
  RuntimeExtensionDisposeReason,
  RuntimeExtensionHost,
} from "./types"
import { aggregateFailure, isDisposeReason, validateContribution } from "./validation"

type MaybePromise<T> = T | Promise<T>

const defaultHost: RuntimeExtensionHost = {
  batch(operation) {
    return fileSystemRegistry.batch(() =>
      ideallRootFileSystem.batch(() =>
        engineRegistry.batch(() => fileEngineRendererRegistry.batch(operation)),
      ),
    )
  },
  mountFileSystem({ provider, mount }) {
    return mountFileSystem(fileSystemRegistry, ideallRootFileSystem, provider, mount)
  },
  registerEngine(contribution) {
    return registerFileEngineContribution(contribution)
  },
}

type CleanupStep = {
  name: string
  phase: "lifecycle" | "host"
  run: () => MaybePromise<void>
  pending: boolean
  failure?: unknown
}

type RegistryRecord = {
  token: symbol
  extension: RuntimeExtensionContribution
  controller: AbortController
  cleanup: CleanupStep[]
  health: "active" | "tearing-down"
  teardown?: Promise<void>
}

type QuarantineRecord = {
  extension: RuntimeExtensionContribution
  controller: AbortController
  cleanup: CleanupStep[]
  failures: unknown[]
}

export type RuntimeExtensionRegistryHealth = "active" | "tearing-down" | "quarantined" | "inactive"

export type RuntimeExtensionDisposeHandle = (
  reason?: RuntimeExtensionDisposeReason,
) => Promise<void>

function cleanupFailures(steps: readonly CleanupStep[]): unknown[] {
  return steps.flatMap((step) => (step.pending && step.failure !== undefined ? [step.failure] : []))
}

function pendingCleanupNames(steps: readonly CleanupStep[]): string[] {
  return steps.filter((step) => step.pending).map((step) => step.name)
}

// 一次性、按 extension id 绑定的内存 permit。签发与消费均只存在于本模块；公共 barrel 不暴露
// permit 类型或 Catalog 专用安装桥，storage、结构相同的普通对象或重复使用都无法绕过。
type RuntimeExtensionActivationPermit = object
const activationPermits = new WeakMap<RuntimeExtensionActivationPermit, string>()

function issueActivationPermit(id: string): RuntimeExtensionActivationPermit {
  const permit = Object.freeze({})
  activationPermits.set(permit, id)
  return permit
}

function consumeActivationPermit(
  permit: RuntimeExtensionActivationPermit,
  extensionId: string,
): boolean {
  const expected = activationPermits.get(permit)
  activationPermits.delete(permit)
  return expected === extensionId
}

/** Runtime contribution registry；不负责发现/信任，只接受 Catalog 已授权的贡献。 */
export class RuntimeExtensionRegistry {
  readonly #host: RuntimeExtensionHost
  readonly #installed = new Map<string, RegistryRecord>()
  readonly #quarantined = new Map<string, QuarantineRecord>()
  readonly #listeners = new Set<() => void>()
  #revision = 0

  constructor(host: RuntimeExtensionHost = defaultHost) {
    this.#host = host
  }

  async install(
    extension: RuntimeExtensionContribution,
    permit: RuntimeExtensionActivationPermit,
    controller = new AbortController(),
  ): Promise<RuntimeExtensionDisposeHandle> {
    validateContribution(extension)
    if (!consumeActivationPermit(permit, extension.id)) {
      throw new Error(`Runtime extension activation is not authorized: ${extension.id}`)
    }
    if (this.#installed.has(extension.id) || this.#quarantined.has(extension.id)) {
      throw new Error(`Runtime extension already installed or quarantined: ${extension.id}`)
    }

    const cleanup: CleanupStep[] = []
    const disposeStep: CleanupStep | null = extension.dispose
      ? {
          name: "lifecycle",
          phase: "lifecycle",
          pending: true,
          run: () =>
            extension.dispose!({ signal: controller.signal, reason: "activation-rollback" }),
        }
      : null
    if (disposeStep) cleanup.push(disposeStep)

    const apply = () => {
      try {
        for (const fileSystem of extension.fileSystems ?? []) {
          const dispose = this.#host.mountFileSystem(fileSystem)
          cleanup.push({
            name: `filesystem:${fileSystem.provider.descriptor.fileSystemId}`,
            phase: "host",
            pending: true,
            run: dispose,
          })
        }
        for (const engine of extension.engines ?? []) {
          const dispose = this.#host.registerEngine(engine)
          cleanup.push({
            name: `engine:${engine.descriptor.engineId}`,
            phase: "host",
            pending: true,
            run: dispose,
          })
        }
      } catch (error) {
        // Host 注册仍在同步 batch 内逆序回滚，观察者不会看到半套 FileSystem/Engine。
        const hostFailures = this.#runHostCleanup(cleanup)
        if (hostFailures.length) {
          throw aggregateFailure(`Runtime extension host rollback failed: ${extension.id}`, [
            error,
            ...hostFailures,
          ])
        }
        throw error
      }
    }

    try {
      await extension.activate?.(controller.signal)
      if (controller.signal.aborted) {
        throw new Error(`Runtime extension activation aborted: ${extension.id}`)
      }
      if (this.#host.batch) this.#host.batch(apply)
      else apply()
    } catch (error) {
      controller.abort(error)
      const reason: RuntimeExtensionDisposeReason = isDisposeReason(controller.signal.reason)
        ? controller.signal.reason
        : "activation-rollback"
      if (disposeStep && extension.dispose) {
        disposeStep.run = () => extension.dispose!({ signal: controller.signal, reason })
      }
      await this.#runLifecycleCleanup(cleanup, reason)
      this.#runHostCleanupInBatch(cleanup)
      const failures = [error, ...cleanupFailures(cleanup)]
      if (pendingCleanupNames(cleanup).length) {
        this.#quarantined.set(extension.id, {
          extension,
          controller,
          cleanup,
          failures,
        })
        this.#notify()
      }
      throw failures.length === 1
        ? error
        : aggregateFailure(`Runtime extension activation failed: ${extension.id}`, failures)
    }

    if (disposeStep) {
      disposeStep.run = () => extension.dispose!({ signal: controller.signal, reason: "uninstall" })
      disposeStep.failure = undefined
    }
    const record: RegistryRecord = {
      token: Symbol(extension.id),
      extension,
      controller,
      cleanup,
      health: "active",
    }
    this.#installed.set(extension.id, record)
    this.#notify()

    let disposed = false
    return async (reason = "uninstall") => {
      if (disposed) return
      disposed = true
      await this.#uninstallRecord(record, reason)
    }
  }

  async uninstall(
    id: string,
    reason: RuntimeExtensionDisposeReason = "uninstall",
  ): Promise<boolean> {
    const installed = this.#installed.get(id)
    if (!installed) return false
    await this.#uninstallRecord(installed, reason)
    return true
  }

  async retryCleanup(id: string): Promise<boolean> {
    const quarantined = this.#quarantined.get(id)
    if (!quarantined) return false
    await this.#runLifecycleCleanup(quarantined.cleanup, "uninstall")
    this.#runHostCleanupInBatch(quarantined.cleanup)
    const failures = cleanupFailures(quarantined.cleanup)
    quarantined.failures = failures
    if (pendingCleanupNames(quarantined.cleanup).length === 0) {
      this.#quarantined.delete(id)
      this.#notify()
      return true
    }
    this.#notify()
    throw aggregateFailure(`Runtime extension remains quarantined: ${id}`, failures)
  }

  has(id: string): boolean {
    return this.#installed.has(id)
  }

  health(id: string): RuntimeExtensionRegistryHealth {
    const installed = this.#installed.get(id)
    if (installed) return installed.health
    if (this.#quarantined.has(id)) return "quarantined"
    return "inactive"
  }

  failure(id: string): unknown | null {
    const quarantined = this.#quarantined.get(id)
    return quarantined
      ? aggregateFailure(`Runtime extension cleanup failed: ${id}`, quarantined.failures)
      : null
  }

  pendingCleanup(id: string): string[] {
    return pendingCleanupNames(this.#quarantined.get(id)?.cleanup ?? [])
  }

  list(): RuntimeExtensionContribution[] {
    return [...this.#installed.values()]
      .map(({ extension }) => extension)
      .sort((left, right) => left.id.localeCompare(right.id))
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  revision(): number {
    return this.#revision
  }

  async clear(): Promise<void> {
    const failures: unknown[] = []
    for (const id of [...this.#installed.keys()]) {
      try {
        await this.uninstall(id)
      } catch (error) {
        failures.push(error)
      }
    }
    for (const id of [...this.#quarantined.keys()]) {
      try {
        await this.retryCleanup(id)
      } catch (error) {
        failures.push(error)
      }
    }
    if (failures.length) {
      throw aggregateFailure("Runtime extension registry cleanup failed", failures)
    }
  }

  async #uninstallRecord(
    record: RegistryRecord,
    reason: RuntimeExtensionDisposeReason,
  ): Promise<void> {
    if (this.#installed.get(record.extension.id) !== record) return
    if (record.teardown) return record.teardown
    record.health = "tearing-down"
    this.#notify()
    record.controller.abort(reason)
    const lifecycle = record.cleanup.find((step) => step.phase === "lifecycle")
    if (lifecycle && record.extension.dispose) {
      lifecycle.run = () => record.extension.dispose!({ signal: record.controller.signal, reason })
    }
    record.teardown = (async () => {
      await this.#runLifecycleCleanup(record.cleanup, reason)
      this.#runHostCleanupInBatch(record.cleanup)
      const failures = cleanupFailures(record.cleanup)
      if (this.#installed.get(record.extension.id) === record) {
        this.#installed.delete(record.extension.id)
      }
      if (pendingCleanupNames(record.cleanup).length) {
        this.#quarantined.set(record.extension.id, {
          extension: record.extension,
          controller: record.controller,
          cleanup: record.cleanup,
          failures,
        })
      }
      this.#notify()
      if (failures.length) {
        throw aggregateFailure(`Runtime extension cleanup failed: ${record.extension.id}`, failures)
      }
    })()
    return record.teardown
  }

  async #runLifecycleCleanup(
    cleanup: readonly CleanupStep[],
    _reason: RuntimeExtensionDisposeReason,
  ): Promise<void> {
    for (const step of cleanup) {
      if (step.phase !== "lifecycle" || !step.pending) continue
      try {
        await step.run()
        step.pending = false
        step.failure = undefined
      } catch (error) {
        step.failure = error
      }
    }
  }

  #runHostCleanupInBatch(cleanup: readonly CleanupStep[]): unknown[] {
    const operation = () => this.#runHostCleanup(cleanup)
    return this.#host.batch ? this.#host.batch(operation) : operation()
  }

  #runHostCleanup(cleanup: readonly CleanupStep[]): unknown[] {
    const failures: unknown[] = []
    for (let index = cleanup.length - 1; index >= 0; index -= 1) {
      const step = cleanup[index]
      if (step.phase !== "host" || !step.pending) continue
      try {
        const result = step.run()
        if (result instanceof Promise) {
          throw new TypeError(`Host cleanup must be synchronous: ${step.name}`)
        }
        step.pending = false
        step.failure = undefined
      } catch (error) {
        step.failure = error
        failures.push(error)
      }
    }
    return failures
  }

  #notify(): void {
    this.#revision += 1
    for (const listener of this.#listeners) {
      try {
        listener()
      } catch {
        // 状态已经提交；订阅者异常只影响该订阅者。
      }
    }
  }
}

/** @internal Catalog 专用桥；不经公共 barrel 导出，permit 的签发与消费仍封闭在本模块。 */
export function installCatalogExtension(
  registry: RuntimeExtensionRegistry,
  extension: RuntimeExtensionContribution,
  extensionId: string,
  controller: AbortController,
): Promise<RuntimeExtensionDisposeHandle> {
  return registry.install(extension, issueActivationPermit(extensionId), controller)
}
