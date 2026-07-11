import type { EngineDescriptor } from "@protocol/engine"
import type { FileSystemProvider } from "@/filesystem/types"
import type { FileSystemMountOptions } from "@/filesystem/composite-root"
import { mountFileSystem } from "@/filesystem/composite-root"
import { ideallRootFileSystem } from "@/filesystem/builtin"
import { fileSystemRegistry } from "@/filesystem/registry"
import { engineRegistry } from "@/engines/builtin"
import { validateEngineDescriptor } from "@/engines/registry"
import {
  fileEngineRendererRegistry,
  type FileEngineRenderer,
} from "@/workspace/file-engine-renderer"
import { registerFileEngineContribution } from "@/workspace/file-engine-registration"

export const RUNTIME_EXTENSION_INSTALLS_STORAGE_KEY = "ideall:runtime-extensions:v2"

const SNAPSHOT_VERSION = 2 as const
const MAX_SNAPSHOT_BYTES = 64 * 1024
const MAX_PERSISTED_EXTENSIONS = 64
const MAX_EXTENSION_ID_LENGTH = 128
const MAX_LABEL_LENGTH = 160
const MAX_DIGEST_LENGTH = 512
const MAX_RECEIPT_LENGTH = 1024
const MAX_PERMISSIONS = 64
const MAX_PERMISSION_LENGTH = 128

type MaybePromise<T> = T | Promise<T>

export type RuntimeFileSystemContribution = Readonly<{
  provider: FileSystemProvider
  mount: FileSystemMountOptions
}>

export type RuntimeEngineContribution = Readonly<{
  descriptor: EngineDescriptor
  renderer: FileEngineRenderer
}>

export type RuntimeExtensionDisposeReason =
  | "uninstall"
  | "revoke"
  | "factory-removed"
  | "activation-rollback"

function isDisposeReason(value: unknown): value is RuntimeExtensionDisposeReason {
  return (
    value === "uninstall" ||
    value === "revoke" ||
    value === "factory-removed" ||
    value === "activation-rollback"
  )
}

export type RuntimeExtensionDisposeContext = Readonly<{
  /** dispose 被调用前一定已经 abort；connector 应让 socket/process/watch 同时监听该 signal。 */
  signal: AbortSignal
  reason: RuntimeExtensionDisposeReason
}>

/**
 * Factory.create 只构造贡献，不应启动外部资源。需要 socket/process/watch 的 connector 在
 * activate(signal) 中启动，在 dispose 中等待它们退出。宿主始终先 teardown 生命周期，之后
 * 才从 FileSystem/Engine registry 注销可见贡献。
 */
export type RuntimeExtensionContribution = Readonly<{
  id: string
  label: string
  fileSystems?: readonly RuntimeFileSystemContribution[]
  engines?: readonly RuntimeEngineContribution[]
  activate?(signal: AbortSignal): MaybePromise<void>
  dispose?(context: RuntimeExtensionDisposeContext): MaybePromise<void>
}>

export type RuntimeExtensionSource =
  | Readonly<{ kind: "builtin"; id: string }>
  | Readonly<{ kind: "package"; id: string; location?: string }>

/**
 * digest/permissionDigest 都由发行流水线或宿主 verifier 提供，本模块不会伪造哈希。
 * 对外部 package，verifier receipt 必须逐字段绑定这些值后才允许 consent/activate。
 */
export type RuntimeExtensionFactory = Readonly<{
  id: string
  label: string
  version: number
  source: RuntimeExtensionSource
  digest: string
  permissionDigest: string
  permissions: readonly string[]
  create(this: void): RuntimeExtensionContribution
}>

export type RuntimeExtensionDescriptor = Readonly<
  Pick<
    RuntimeExtensionFactory,
    "id" | "label" | "version" | "source" | "digest" | "permissionDigest" | "permissions"
  >
>

export type RuntimeExtensionVerificationReceipt = Readonly<{
  receiptId: string
  verifierId: string
  id: string
  version: number
  digest: string
  permissionDigest: string
  verifiedAt: number
}>

export type RuntimeExtensionConsentReceipt = Readonly<{
  receiptId: string
  id: string
  version: number
  digest: string
  permissionDigest: string
  grantedAt: number
}>

/** 外部 package 的 verifier 必须由桌面宿主注入；缺省即 fail closed。 */
export type RuntimeExtensionVerifier = Readonly<{
  verify(
    descriptor: RuntimeExtensionDescriptor,
  ): MaybePromise<RuntimeExtensionVerificationReceipt | null>
}>

/** Consent receipt 的签发和恢复同样由宿主注入；localStorage 中的字符串本身从不被信任。 */
export type RuntimeExtensionConsentAuthority = Readonly<{
  request(
    descriptor: RuntimeExtensionDescriptor,
    verification: RuntimeExtensionVerificationReceipt,
  ): MaybePromise<RuntimeExtensionConsentReceipt | null>
  restore(
    descriptor: RuntimeExtensionDescriptor,
    verification: RuntimeExtensionVerificationReceipt,
    persistedReceiptId: string,
  ): MaybePromise<RuntimeExtensionConsentReceipt | null>
  revoke?(receipt: RuntimeExtensionConsentReceipt): MaybePromise<void>
}>

export type RuntimeExtensionHost = Readonly<{
  batch?<T>(operation: () => T): T
  mountFileSystem(contribution: RuntimeFileSystemContribution): () => void
  registerEngine(contribution: RuntimeEngineContribution): () => void
}>

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

function validExtensionId(id: string): boolean {
  return id.length <= MAX_EXTENSION_ID_LENGTH && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(id)
}

function validBoundedText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/.test(value)
  )
}

function validPermission(permission: unknown): permission is string {
  return (
    validBoundedText(permission, MAX_PERMISSION_LENGTH) &&
    /^[A-Za-z0-9][A-Za-z0-9:._/-]*$/.test(permission)
  )
}

function validateFactory(
  factory: RuntimeExtensionFactory,
  expectedKind: RuntimeExtensionSource["kind"],
): void {
  if (
    !validExtensionId(factory.id) ||
    !validBoundedText(factory.label, MAX_LABEL_LENGTH) ||
    !Number.isSafeInteger(factory.version) ||
    factory.version < 1 ||
    factory.source.kind !== expectedKind ||
    !validBoundedText(factory.source.id, MAX_EXTENSION_ID_LENGTH) ||
    !validBoundedText(factory.digest, MAX_DIGEST_LENGTH) ||
    !validBoundedText(factory.permissionDigest, MAX_DIGEST_LENGTH) ||
    !Array.isArray(factory.permissions) ||
    factory.permissions.length > MAX_PERMISSIONS ||
    factory.permissions.some((permission) => !validPermission(permission)) ||
    new Set(factory.permissions).size !== factory.permissions.length ||
    typeof factory.create !== "function"
  ) {
    throw new TypeError(`Invalid runtime extension factory: ${factory.id}`)
  }
  if (
    factory.source.kind === "package" &&
    factory.source.location !== undefined &&
    !validBoundedText(factory.source.location, MAX_DIGEST_LENGTH)
  ) {
    throw new TypeError(`Invalid runtime extension package location: ${factory.id}`)
  }
}

function descriptorFor(factory: RuntimeExtensionFactory): RuntimeExtensionDescriptor {
  return Object.freeze({
    id: factory.id,
    label: factory.label,
    version: factory.version,
    source: Object.freeze({ ...factory.source }),
    digest: factory.digest,
    permissionDigest: factory.permissionDigest,
    permissions: Object.freeze([...factory.permissions]),
  })
}

function validateContribution(extension: RuntimeExtensionContribution): void {
  if (!validExtensionId(extension.id)) {
    throw new TypeError(`Invalid runtime extension id: ${extension.id}`)
  }
  if (!validBoundedText(extension.label, MAX_LABEL_LENGTH)) {
    throw new TypeError("Runtime extension label cannot be empty")
  }

  const fileSystemIds = new Set<string>()
  const mountIds = new Set<string>()
  for (const { provider, mount } of extension.fileSystems ?? []) {
    const fileSystemId = provider.descriptor.fileSystemId
    if (fileSystemIds.has(fileSystemId)) {
      throw new TypeError(`Duplicate file system in extension ${extension.id}: ${fileSystemId}`)
    }
    if (mountIds.has(mount.entryId)) {
      throw new TypeError(`Duplicate mount in extension ${extension.id}: ${mount.entryId}`)
    }
    fileSystemIds.add(fileSystemId)
    mountIds.add(mount.entryId)
  }

  const engineIds = new Set<string>()
  for (const { descriptor, renderer } of extension.engines ?? []) {
    validateEngineDescriptor(descriptor)
    if (typeof renderer !== "function") {
      throw new TypeError(`Invalid runtime extension renderer: ${descriptor.engineId}`)
    }
    if (engineIds.has(descriptor.engineId)) {
      throw new TypeError(`Duplicate engine in extension ${extension.id}: ${descriptor.engineId}`)
    }
    engineIds.add(descriptor.engineId)
  }
  if (extension.activate !== undefined && typeof extension.activate !== "function") {
    throw new TypeError(`Invalid activation callback: ${extension.id}`)
  }
  if (extension.dispose !== undefined && typeof extension.dispose !== "function") {
    throw new TypeError(`Invalid disposal callback: ${extension.id}`)
  }
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

function aggregateFailure(message: string, failures: readonly unknown[]): AggregateError {
  return new AggregateError([...failures], message)
}

// 一次性、按 extension id 绑定的内存 permit。只有本模块内通过 verify/consent 或 builtin 路径的
// Catalog 能签发；storage、结构相同的普通对象或重复使用都无法绕过。
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

    // 正常卸载时 lifecycle dispose 的 reason 与 rollback 不同。
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
    if (failures.length)
      throw aggregateFailure("Runtime extension registry cleanup failed", failures)
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

export type RuntimeExtensionInstallRecord = Readonly<{
  id: string
  version: number
  digest: string
  permissionDigest: string
  consentReceipt: string
}>

type InstallSnapshot = Readonly<{
  version: typeof SNAPSHOT_VERSION
  records: readonly RuntimeExtensionInstallRecord[]
}>

export type ExtensionStorage = Pick<Storage, "getItem" | "setItem">

export type RuntimeExtensionCatalogOptions = Readonly<{
  storage?: ExtensionStorage
  verifier?: RuntimeExtensionVerifier
  consent?: RuntimeExtensionConsentAuthority
}>

export type RuntimeExtensionHealth =
  | "discovered"
  | "verifying"
  | "verified"
  | "consent-required"
  | "ready"
  | "activating"
  | "active"
  | "tearing-down"
  | "degraded"
  | "quarantined"
  | "revoked"
  | "unavailable"

export type RuntimeExtensionCatalogState = Readonly<{
  id: string
  label: string
  version: number
  source: RuntimeExtensionSource | null
  permissions: readonly string[]
  digest: string
  permissionDigest: string
  consentReceipt: string | null
  desired: boolean
  health: RuntimeExtensionHealth
  failure: unknown | null
  pendingCleanup: readonly string[]
}>

type CatalogEntry = {
  factory: RuntimeExtensionFactory
  descriptor: RuntimeExtensionDescriptor
  verification?: RuntimeExtensionVerificationReceipt
  consent?: RuntimeExtensionConsentReceipt
  health: RuntimeExtensionHealth
  failure?: unknown
  activation?: Promise<void>
  runtimeDispose?: RuntimeExtensionDisposeHandle
  activationController?: AbortController
  disposed: boolean
}

function snapshotFactory(factory: RuntimeExtensionFactory): RuntimeExtensionFactory {
  const descriptor = descriptorFor(factory)
  const create = factory.create
  return Object.freeze({
    ...descriptor,
    create,
  })
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function parseInstallRecord(value: unknown): RuntimeExtensionInstallRecord | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["id", "version", "digest", "permissionDigest", "consentReceipt"])
  ) {
    return null
  }
  if (
    typeof value.id !== "string" ||
    !validExtensionId(value.id) ||
    !Number.isSafeInteger(value.version) ||
    (value.version as number) < 1 ||
    !validBoundedText(value.digest, MAX_DIGEST_LENGTH) ||
    !validBoundedText(value.permissionDigest, MAX_DIGEST_LENGTH) ||
    !validBoundedText(value.consentReceipt, MAX_RECEIPT_LENGTH)
  ) {
    return null
  }
  return {
    id: value.id,
    version: value.version as number,
    digest: value.digest,
    permissionDigest: value.permissionDigest,
    consentReceipt: value.consentReceipt,
  }
}

function parseSnapshot(raw: string): InstallSnapshot | null {
  if (new TextEncoder().encode(raw).byteLength > MAX_SNAPSHOT_BYTES) return null
  let value: unknown
  try {
    value = JSON.parse(raw) as unknown
  } catch {
    return null
  }
  if (!isRecord(value) || !exactKeys(value, ["version", "records"])) return null
  if (value.version !== SNAPSHOT_VERSION || !Array.isArray(value.records)) return null
  if (value.records.length > MAX_PERSISTED_EXTENSIONS) return null
  const records = value.records.map(parseInstallRecord)
  if (records.some((record) => record === null)) return null
  const complete = records as RuntimeExtensionInstallRecord[]
  if (new Set(complete.map((record) => record.id)).size !== complete.length) return null
  return { version: SNAPSHOT_VERSION, records: complete }
}

function matchesDescriptor(
  record: RuntimeExtensionInstallRecord,
  descriptor: RuntimeExtensionDescriptor,
): boolean {
  return (
    record.id === descriptor.id &&
    record.version === descriptor.version &&
    record.digest === descriptor.digest &&
    record.permissionDigest === descriptor.permissionDigest
  )
}

function validVerificationReceipt(
  receipt: RuntimeExtensionVerificationReceipt | null,
  descriptor: RuntimeExtensionDescriptor,
): receipt is RuntimeExtensionVerificationReceipt {
  return Boolean(
    receipt &&
    validBoundedText(receipt.receiptId, MAX_RECEIPT_LENGTH) &&
    validBoundedText(receipt.verifierId, MAX_EXTENSION_ID_LENGTH) &&
    Number.isFinite(receipt.verifiedAt) &&
    receipt.verifiedAt >= 0 &&
    receipt.id === descriptor.id &&
    receipt.version === descriptor.version &&
    receipt.digest === descriptor.digest &&
    receipt.permissionDigest === descriptor.permissionDigest,
  )
}

function snapshotVerificationReceipt(
  receipt: RuntimeExtensionVerificationReceipt,
): RuntimeExtensionVerificationReceipt {
  return Object.freeze({
    receiptId: receipt.receiptId,
    verifierId: receipt.verifierId,
    id: receipt.id,
    version: receipt.version,
    digest: receipt.digest,
    permissionDigest: receipt.permissionDigest,
    verifiedAt: receipt.verifiedAt,
  })
}

function acceptedVerificationReceipt(
  candidate: RuntimeExtensionVerificationReceipt | null,
  descriptor: RuntimeExtensionDescriptor,
): RuntimeExtensionVerificationReceipt | null {
  try {
    if (!candidate) return null
    const receipt = snapshotVerificationReceipt(candidate)
    return validVerificationReceipt(receipt, descriptor) ? receipt : null
  } catch {
    return null
  }
}

function validConsentReceipt(
  receipt: RuntimeExtensionConsentReceipt | null,
  descriptor: RuntimeExtensionDescriptor,
): receipt is RuntimeExtensionConsentReceipt {
  return Boolean(
    receipt &&
    validBoundedText(receipt.receiptId, MAX_RECEIPT_LENGTH) &&
    Number.isFinite(receipt.grantedAt) &&
    receipt.grantedAt >= 0 &&
    receipt.id === descriptor.id &&
    receipt.version === descriptor.version &&
    receipt.digest === descriptor.digest &&
    receipt.permissionDigest === descriptor.permissionDigest,
  )
}

function snapshotConsentReceipt(
  receipt: RuntimeExtensionConsentReceipt,
): RuntimeExtensionConsentReceipt {
  return Object.freeze({
    receiptId: receipt.receiptId,
    id: receipt.id,
    version: receipt.version,
    digest: receipt.digest,
    permissionDigest: receipt.permissionDigest,
    grantedAt: receipt.grantedAt,
  })
}

function acceptedConsentReceipt(
  candidate: RuntimeExtensionConsentReceipt | null,
  descriptor: RuntimeExtensionDescriptor,
): RuntimeExtensionConsentReceipt | null {
  try {
    if (!candidate) return null
    const receipt = snapshotConsentReceipt(candidate)
    return validConsentReceipt(receipt, descriptor) ? receipt : null
  } catch {
    return null
  }
}

function installRecord(
  descriptor: RuntimeExtensionDescriptor,
  consentReceipt: string,
): RuntimeExtensionInstallRecord {
  return {
    id: descriptor.id,
    version: descriptor.version,
    digest: descriptor.digest,
    permissionDigest: descriptor.permissionDigest,
    consentReceipt,
  }
}

/**
 * 可信扩展状态机：discover 只保存宿主给出的内存 factory；verify/consent 都调用注入边界；activate
 * 才会执行 factory.create。hydrate 只解析记录，永远不会把 storage 字段当作代码或自动信任 receipt。
 */
export class RuntimeExtensionCatalog {
  readonly #registry: RuntimeExtensionRegistry
  readonly #storage?: ExtensionStorage
  readonly #verifier?: RuntimeExtensionVerifier
  readonly #consentAuthority?: RuntimeExtensionConsentAuthority
  readonly #entries = new Map<string, CatalogEntry>()
  readonly #wanted = new Map<string, RuntimeExtensionInstallRecord>()
  readonly #failures = new Map<string, unknown>()
  readonly #listeners = new Set<() => void>()
  #revision = 0
  #hydrated = false

  constructor(registry: RuntimeExtensionRegistry, options: RuntimeExtensionCatalogOptions = {}) {
    this.#registry = registry
    this.#storage = options.storage
    this.#verifier = options.verifier
    this.#consentAuthority = options.consent
  }

  discoverBuiltin(factory: RuntimeExtensionFactory): () => Promise<void> {
    return this.#discover(factory, "builtin")
  }

  discover(factory: RuntimeExtensionFactory): () => Promise<void> {
    return this.#discover(factory, "package")
  }

  async verify(id: string): Promise<RuntimeExtensionVerificationReceipt> {
    const entry = this.#requireEntry(id)
    if (entry.factory.source.kind === "builtin") {
      throw new Error(`Built-in extension does not use package verification: ${id}`)
    }
    if (!this.#verifier) throw new Error(`No runtime extension verifier configured: ${id}`)
    entry.health = "verifying"
    entry.failure = undefined
    this.#notify()
    try {
      const candidate = await this.#verifier.verify(entry.descriptor)
      const receipt = acceptedVerificationReceipt(candidate, entry.descriptor)
      if (!receipt) {
        throw new Error(`Runtime extension verification rejected: ${id}`)
      }
      entry.verification = receipt
      entry.health = "verified"
      this.#failures.delete(id)
      this.#notify()
      return receipt
    } catch (error) {
      entry.health = "degraded"
      entry.failure = error
      this.#failures.set(id, error)
      this.#notify()
      throw error
    }
  }

  async consent(id: string): Promise<RuntimeExtensionConsentReceipt> {
    const entry = this.#requireEntry(id)
    if (entry.factory.source.kind === "builtin") {
      throw new Error(`Built-in extension is trusted by the bundled host: ${id}`)
    }
    const verification = entry.verification ?? (await this.verify(id))
    if (!this.#consentAuthority) throw new Error(`No extension consent authority configured: ${id}`)
    const candidate = await this.#consentAuthority.request(entry.descriptor, verification)
    const receipt = acceptedConsentReceipt(candidate, entry.descriptor)
    if (!receipt) {
      const error = new Error(`Runtime extension consent rejected: ${id}`)
      entry.health = "consent-required"
      entry.failure = error
      this.#failures.set(id, error)
      this.#notify()
      throw error
    }
    entry.consent = receipt
    entry.health = "ready"
    entry.failure = undefined
    this.#wanted.set(id, installRecord(entry.descriptor, receipt.receiptId))
    this.#failures.delete(id)
    this.#persist()
    this.#notify()
    return receipt
  }

  async restoreConsent(id: string): Promise<boolean> {
    const entry = this.#requireEntry(id)
    const wanted = this.#wanted.get(id)
    if (!wanted || !matchesDescriptor(wanted, entry.descriptor)) {
      entry.health = "consent-required"
      entry.consent = undefined
      this.#notify()
      return false
    }
    if (entry.factory.source.kind === "builtin") {
      entry.health = "ready"
      this.#notify()
      return true
    }
    const verification = entry.verification ?? (await this.verify(id))
    if (!this.#consentAuthority) {
      entry.health = "consent-required"
      this.#notify()
      return false
    }
    const candidate = await this.#consentAuthority.restore(
      entry.descriptor,
      verification,
      wanted.consentReceipt,
    )
    const receipt = acceptedConsentReceipt(candidate, entry.descriptor)
    if (!receipt || receipt.receiptId !== wanted.consentReceipt) {
      entry.health = "consent-required"
      entry.consent = undefined
      this.#notify()
      return false
    }
    entry.consent = receipt
    entry.health = "ready"
    entry.failure = undefined
    this.#failures.delete(id)
    this.#notify()
    return true
  }

  async activate(id: string): Promise<void> {
    const entry = this.#requireEntry(id)
    if (entry.activation) return entry.activation
    if (this.#registry.health(id) === "quarantined") {
      throw new Error(`Runtime extension is quarantined: ${id}`)
    }
    if (this.#registry.has(id)) {
      if (entry.runtimeDispose) {
        entry.health = "active"
        this.#notify()
        return
      }
      throw new Error(`Runtime extension id is still owned by another factory: ${id}`)
    }

    if (entry.factory.source.kind === "builtin") {
      const receiptId = `builtin:${entry.descriptor.id}:${entry.descriptor.version}`
      this.#wanted.set(id, installRecord(entry.descriptor, receiptId))
      this.#persist()
    } else if (!entry.consent || !validConsentReceipt(entry.consent, entry.descriptor)) {
      entry.health = "consent-required"
      this.#notify()
      throw new Error(`Runtime extension consent required: ${id}`)
    }

    entry.health = "activating"
    entry.failure = undefined
    this.#notify()
    const activation = (async () => {
      let dispose: RuntimeExtensionDisposeHandle | undefined
      try {
        const extension = entry.factory.create()
        if (extension.id !== entry.factory.id) {
          throw new Error(
            `Runtime extension factory id mismatch: ${entry.factory.id} != ${extension.id}`,
          )
        }
        const controller = new AbortController()
        entry.activationController = controller
        dispose = await this.#registry.install(extension, issueActivationPermit(id), controller)
        entry.runtimeDispose = dispose
        if (entry.disposed || this.#entries.get(id) !== entry) {
          await dispose("factory-removed")
          return
        }
        entry.health = "active"
        entry.failure = undefined
        this.#failures.delete(id)
        this.#notify()
      } catch (error) {
        entry.health = this.#registry.health(id) === "quarantined" ? "quarantined" : "degraded"
        entry.failure = error
        this.#failures.set(id, error)
        this.#notify()
        throw error
      } finally {
        entry.activation = undefined
        if (!entry.runtimeDispose) entry.activationController = undefined
      }
    })()
    entry.activation = activation
    return activation
  }

  async tryActivate(id: string): Promise<boolean> {
    try {
      await this.activate(id)
      return true
    } catch {
      return false
    }
  }

  async resume(id: string): Promise<boolean> {
    const entry = this.#requireEntry(id)
    if (this.#registry.health(id) === "quarantined") {
      await this.#registry.retryCleanup(id)
      entry.failure = undefined
      this.#failures.delete(id)
      this.#notify()
    }
    if (entry.factory.source.kind === "package" && !entry.consent) {
      const restored = await this.restoreConsent(id)
      if (!restored) return false
    }
    return this.tryActivate(id)
  }

  async retry(id: string): Promise<boolean> {
    return this.resume(id)
  }

  async uninstall(id: string, reason: "uninstall" | "revoke" = "uninstall"): Promise<boolean> {
    const entry = this.#entries.get(id)
    const changed = this.#wanted.delete(id) || this.#registry.health(id) !== "inactive"
    let failure: unknown
    try {
      entry?.activationController?.abort(reason)
      try {
        await entry?.activation
      } catch {
        // 主动卸载导致的 activation rejection 已由 Registry 完成 rollback；继续检查 quarantine。
      }
      if (this.#registry.has(id)) await this.#registry.uninstall(id, reason)
      if (this.#registry.health(id) === "quarantined") await this.#registry.retryCleanup(id)
    } catch (error) {
      failure = error
      this.#failures.set(id, error)
    } finally {
      if (entry) {
        entry.consent = undefined
        entry.health =
          this.#registry.health(id) === "quarantined"
            ? "quarantined"
            : entry.factory.source.kind === "builtin"
              ? "ready"
              : "consent-required"
        entry.failure = failure
      }
      if (failure === undefined) this.#failures.delete(id)
      this.#persist()
      this.#notify()
    }
    if (failure !== undefined) throw failure
    return changed
  }

  async revoke(id: string): Promise<boolean> {
    const entry = this.#requireEntry(id)
    if (entry.factory.source.kind === "builtin") {
      throw new Error(`Built-in extension trust cannot be revoked: ${id}`)
    }
    const wanted = this.#wanted.get(id)
    let consent = entry.consent
    const failures: unknown[] = []
    if (!consent && wanted) {
      if (!matchesDescriptor(wanted, entry.descriptor)) {
        failures.push(
          new Error(`Persisted consent does not match the current extension descriptor: ${id}`),
        )
      } else {
        try {
          const restored = await this.restoreConsent(id)
          consent = restored ? entry.consent : undefined
          if (!consent) {
            throw new Error(`Persisted runtime extension consent could not be restored: ${id}`)
          }
        } catch (error) {
          failures.push(error)
        }
      }
    }
    try {
      await this.uninstall(id, "revoke")
    } catch (error) {
      failures.push(error)
    }
    entry.verification = undefined
    entry.consent = undefined
    entry.health = this.#registry.health(id) === "quarantined" ? "quarantined" : "revoked"
    if (consent) {
      if (!this.#consentAuthority?.revoke) {
        failures.push(new Error(`No extension consent revocation authority configured: ${id}`))
      } else {
        try {
          await this.#consentAuthority.revoke(consent)
        } catch (error) {
          failures.push(error)
        }
      }
    }
    this.#wanted.delete(id)
    if (failures.length === 0) {
      entry.failure = undefined
      this.#failures.delete(id)
    } else {
      const failure = aggregateFailure(`Runtime extension revoke failed: ${id}`, failures)
      entry.failure = failure
      this.#failures.set(id, failure)
    }
    this.#persist()
    this.#notify()
    if (failures.length) throw aggregateFailure(`Runtime extension revoke failed: ${id}`, failures)
    return true
  }

  hydrate(): void {
    if (this.#hydrated) return
    this.#hydrated = true
    let raw: string | null | undefined
    try {
      raw = this.#storage?.getItem(RUNTIME_EXTENSION_INSTALLS_STORAGE_KEY)
    } catch (error) {
      this.#failures.set("$storage", error)
    }
    if (raw) {
      const snapshot = parseSnapshot(raw)
      if (!snapshot) {
        this.#failures.set("$snapshot", new Error("Invalid runtime extension snapshot"))
      } else {
        for (const record of snapshot.records) this.#wanted.set(record.id, record)
      }
    }
    for (const entry of this.#entries.values()) this.#refreshTrustHealth(entry)
    this.#notify()
  }

  state(id: string): RuntimeExtensionCatalogState | null {
    const entry = this.#entries.get(id)
    const wanted = this.#wanted.get(id)
    if (!entry && !wanted) return null
    if (!entry && wanted) {
      return {
        id,
        label: id,
        version: wanted.version,
        source: null,
        permissions: [],
        digest: wanted.digest,
        permissionDigest: wanted.permissionDigest,
        consentReceipt: wanted.consentReceipt,
        desired: true,
        health: "unavailable",
        failure: this.#failures.get(id) ?? null,
        pendingCleanup: this.#registry.pendingCleanup(id),
      }
    }
    const current = entry!
    const registryHealth = this.#registry.health(id)
    const health =
      registryHealth === "quarantined"
        ? "quarantined"
        : registryHealth === "tearing-down" && current.runtimeDispose
          ? "tearing-down"
          : registryHealth === "active" && current.runtimeDispose
            ? "active"
            : current.health
    return {
      id,
      label: current.descriptor.label,
      version: current.descriptor.version,
      source: current.descriptor.source,
      permissions: current.descriptor.permissions,
      digest: current.descriptor.digest,
      permissionDigest: current.descriptor.permissionDigest,
      consentReceipt: wanted?.consentReceipt ?? current.consent?.receiptId ?? null,
      desired: Boolean(wanted),
      health,
      failure: current.failure ?? this.#registry.failure(id) ?? this.#failures.get(id) ?? null,
      pendingCleanup: this.#registry.pendingCleanup(id),
    }
  }

  states(): RuntimeExtensionCatalogState[] {
    const ids = new Set([...this.#entries.keys(), ...this.#wanted.keys()])
    return [...ids].sort((left, right) => left.localeCompare(right)).map((id) => this.state(id)!)
  }

  installedIds(): string[] {
    return [...this.#wanted.keys()].sort()
  }

  failure(id: string): unknown | null {
    return this.state(id)?.failure ?? this.#failures.get(id) ?? null
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  revision(): number {
    return this.#revision
  }

  #discover(
    factory: RuntimeExtensionFactory,
    expectedKind: RuntimeExtensionSource["kind"],
  ): () => Promise<void> {
    validateFactory(factory, expectedKind)
    const storedFactory = snapshotFactory(factory)
    // Revalidate the immutable snapshot too: a Proxy/getter cannot pass validation and then
    // return a different descriptor while the trusted factory is being captured.
    validateFactory(storedFactory, expectedKind)
    const id = storedFactory.id
    if (this.#entries.has(id)) {
      throw new Error(`Runtime extension factory already discovered: ${id}`)
    }
    const entry: CatalogEntry = {
      factory: storedFactory,
      descriptor: descriptorFor(storedFactory),
      health: expectedKind === "builtin" ? "ready" : "discovered",
      disposed: false,
    }
    this.#entries.set(id, entry)
    if (this.#hydrated) this.#refreshTrustHealth(entry)
    this.#notify()

    let disposed = false
    return async () => {
      if (disposed) return
      disposed = true
      entry.disposed = true
      entry.activationController?.abort("factory-removed")
      const entryId = entry.descriptor.id
      if (this.#entries.get(entryId) !== entry) return
      this.#entries.delete(entryId)
      this.#notify()
      try {
        await entry.activation
      } catch {
        // activation failure 已进入 entry/registry diagnostics；继续尝试 teardown。
      }
      try {
        await entry.runtimeDispose?.("factory-removed")
        this.#failures.delete(entryId)
      } catch (error) {
        this.#failures.set(entryId, error)
        throw error
      }
    }
  }

  #requireEntry(id: string): CatalogEntry {
    const entry = this.#entries.get(id)
    if (!entry) throw new Error(`Unknown runtime extension: ${id}`)
    return entry
  }

  #refreshTrustHealth(entry: CatalogEntry): void {
    const wanted = this.#wanted.get(entry.descriptor.id)
    if (!wanted) return
    if (!matchesDescriptor(wanted, entry.descriptor)) {
      entry.consent = undefined
      entry.health = "consent-required"
      return
    }
    entry.health = entry.factory.source.kind === "builtin" ? "ready" : "consent-required"
  }

  #persist(): void {
    try {
      const records = [...this.#wanted.values()].sort((left, right) =>
        left.id.localeCompare(right.id),
      )
      if (records.length > MAX_PERSISTED_EXTENSIONS) {
        throw new Error("Too many runtime extension records")
      }
      const value = JSON.stringify({ version: SNAPSHOT_VERSION, records } satisfies InstallSnapshot)
      if (new TextEncoder().encode(value).byteLength > MAX_SNAPSHOT_BYTES) {
        throw new Error("Runtime extension snapshot exceeds size limit")
      }
      this.#storage?.setItem(RUNTIME_EXTENSION_INSTALLS_STORAGE_KEY, value)
      this.#failures.delete("$storage")
    } catch (error) {
      // 运行态不因 localStorage 故障回滚，但状态面可诊断。
      this.#failures.set("$storage", error)
    }
  }

  #notify(): void {
    this.#revision += 1
    for (const listener of this.#listeners) {
      try {
        listener()
      } catch {
        // 状态已经提交；观察者故障不影响信任/生命周期事务。
      }
    }
  }
}

function browserExtensionStorage(): ExtensionStorage | undefined {
  if (typeof window === "undefined") return undefined
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

export const runtimeExtensionRegistry = new RuntimeExtensionRegistry()

// 缺省没有 package verifier/consent authority，因此全局目录只能 discoverBuiltin；外部 loader 必须
// 由桌面宿主构造自己的 Catalog 或在后续 composition root 注入这两个 fail-closed 边界。
export const runtimeExtensionCatalog = new RuntimeExtensionCatalog(runtimeExtensionRegistry, {
  storage: browserExtensionStorage(),
})
