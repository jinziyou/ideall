import {
  RUNTIME_EXTENSION_INSTALLS_STORAGE_KEY,
  acceptedConsentReceipt,
  acceptedVerificationReceipt,
  installRecord,
  matchesDescriptor,
  parseInstallSnapshot,
  serializeInstallSnapshot,
  validConsentReceipt,
  type ExtensionStorage,
  type RuntimeExtensionInstallRecord,
} from "./persistence"
import {
  RuntimeExtensionRegistry,
  installCatalogExtension,
  type RuntimeExtensionDisposeHandle,
} from "./registry"
import type {
  RuntimeExtensionConsentAuthority,
  RuntimeExtensionConsentReceipt,
  RuntimeExtensionDescriptor,
  RuntimeExtensionFactory,
  RuntimeExtensionSource,
  RuntimeExtensionVerificationReceipt,
  RuntimeExtensionVerifier,
} from "./types"
import { aggregateFailure, descriptorFor, snapshotFactory, validateFactory } from "./validation"

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
        dispose = await installCatalogExtension(this.#registry, extension, id, controller)
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
      const snapshot = parseInstallSnapshot(raw)
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
    // 不可变快照也必须重新校验：Proxy/getter 不能先通过校验，再在捕获可信 factory 时返回另一套描述。
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
      const value = serializeInstallSnapshot(records)
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
