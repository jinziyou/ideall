import { isTauri } from "./tauri"

/**
 * 迁移与全部 secure 写/删共用的读写互斥：迁移取**写者**（独占），secureSet/secureDelete
 * 取**读者**（彼此共享）。防迁移的 check-then-set 与并发 revoke/凭据轮转交错
 * （复活已撤销 token / 用旧 fallback 覆盖新提交）。
 * 读者彼此不互斥——单个 secure 写/删本身是原子的，且 Web 形态读操作保持既有的
 * 同步生效语义（clearMcpAuth 等 fire-and-forget 调用方依赖即时生效）；
 * 迁移持写者锁时，读者的并发操作一律排在其后（后写胜出，结果确定）。
 */

const SECURE_RW_LOCK_NAME = "ideall:secure-store-migration"

class ReadWriteMutex {
  #activeReaders = 0
  #activeWriter = false
  #queue: Array<{ shared: boolean; grant: () => void }> = []

  /** 同步快路径：无写者且无排队写者时读者立即共享；无读者且无排队时写者立即独占。 */
  tryAcquire(shared: boolean): (() => void) | null {
    if (shared && !this.#activeWriter && this.#queue.every((request) => request.shared)) {
      return this.#grantShared()
    }
    if (!shared && !this.#activeWriter && this.#activeReaders === 0 && this.#queue.length === 0) {
      return this.#grantExclusive()
    }
    return null
  }

  queue(shared: boolean): Promise<() => void> {
    return new Promise((resolve) => {
      this.#queue.push({
        shared,
        grant: () => resolve(shared ? this.#grantShared() : this.#grantExclusive()),
      })
    })
  }

  #grantShared(): () => void {
    this.#activeReaders += 1
    let released = false
    return () => {
      if (released) return
      released = true
      this.#activeReaders -= 1
      this.#drain()
    }
  }

  #grantExclusive(): () => void {
    this.#activeWriter = true
    let released = false
    return () => {
      if (released) return
      released = true
      this.#activeWriter = false
      this.#drain()
    }
  }

  /** 写者优先：队首写者在没有活跃读者时授予；连续读者批量授予。 */
  #drain(): void {
    while (this.#queue.length > 0) {
      const head = this.#queue[0]
      if (head.shared) {
        if (this.#activeWriter) return
        this.#queue.shift()
        head.grant()
        continue
      }
      if (this.#activeWriter || this.#activeReaders > 0) return
      this.#queue.shift()
      head.grant()
    }
  }
}

const localRwMutex = new ReadWriteMutex()

type WebLockManagerLike = {
  request(
    name: string,
    options: { mode: "shared" | "exclusive" },
    callback: () => Promise<unknown>,
  ): Promise<unknown>
}

function webLockManager(): WebLockManagerLike | null {
  if (typeof navigator === "undefined") return null
  try {
    const locks = (navigator as Navigator & { locks?: WebLockManagerLike }).locks
    return locks && typeof locks.request === "function" ? locks : null
  } catch {
    return null
  }
}

async function withSecureRwLock<T>(shared: boolean, operation: () => T | Promise<T>): Promise<T> {
  const manager = webLockManager()
  if (manager) {
    try {
      return (await manager.request(
        SECURE_RW_LOCK_NAME,
        { mode: shared ? "shared" : "exclusive" },
        async () => operation(),
      )) as T
    } catch (error) {
      // Web Locks 授权前失败可安全回退本地互斥；授权后失败不能重放（操作可能已生效）。
      if (error instanceof Error && /abort/i.test(error.message)) throw error
    }
  }
  // 同步快路径：读者在锁空闲时不进微任务——Web 形态的 secure 写/删保持既有即时生效语义
  // （clearMcpAuth 等 fire-and-forget 调用方依赖调用返回时副作用已发生）。
  const fastRelease = localRwMutex.tryAcquire(shared)
  if (fastRelease) {
    try {
      return await operation()
    } finally {
      fastRelease()
    }
  }
  const release = await localRwMutex.queue(shared)
  try {
    return await operation()
  } finally {
    release()
  }
}

export type SecureStoreBackend = "system-keychain" | "web-localStorage" | "unavailable"

export type SecureStoreStatus = {
  backend: SecureStoreBackend
  native: boolean
  error?: string
}

export type SecureStoreSelfTestResult = {
  backend: "system-keychain"
  roundTrip: true
  cleanedUp: true
}

export type SecureStoreMigrationResult = {
  available: boolean
  migrated: number
  removedPlaintext: number
  failed: number
  remaining: number
}

export class SecureStoreUnavailableError extends Error {
  override name = "SecureStoreUnavailableError"

  constructor(operation: "write" | "delete", cause?: unknown) {
    super(
      operation === "write"
        ? "系统凭据库不可用，敏感信息未保存"
        : "系统凭据库不可用，敏感信息未删除",
      { cause },
    )
  }
}

export const SECURE_STORE_KEYS = {
  AUTH_TOKEN: "ideall:auth:token",
  SYNC_CODE: "ideall:sync:code",
  AGENT_SETTINGS_API_KEY: "ideall:agent:settings:apiKey",
} as const

export const LEGACY_PUBLIC_STORAGE_KEYS = {
  AUTH_TOKEN: "wonita:auth:token",
  SYNC_CODE: "wonita:sync:code",
} as const

type SecureStoreKnownItem = {
  id: string
  label: string
  owner: string
  key: string
  legacyKey?: string
}

export type SecureStoreDynamicItem = Readonly<{
  id: string
  label: string
  owner: string
  key: string
}>

const SECURE_STORE_KNOWN_ITEMS: SecureStoreKnownItem[] = [
  {
    id: "auth.token",
    label: "登录令牌",
    owner: "auth",
    key: SECURE_STORE_KEYS.AUTH_TOKEN,
    legacyKey: LEGACY_PUBLIC_STORAGE_KEYS.AUTH_TOKEN,
  },
  {
    id: "sync.code",
    label: "同步码",
    owner: "sync",
    key: SECURE_STORE_KEYS.SYNC_CODE,
    legacyKey: LEGACY_PUBLIC_STORAGE_KEYS.SYNC_CODE,
  },
  {
    id: "agent.settings.apiKey",
    label: "全局 AI API Key",
    owner: "agent",
    key: SECURE_STORE_KEYS.AGENT_SETTINGS_API_KEY,
  },
]

const dynamicItemSources = new Set<() => readonly SecureStoreDynamicItem[]>()

/**
 * Owner 注册其动态 secure key 家族（如 `ideall:agent:secret:{id}`、
 * `ideall:agent:oauth:{serverId}:tokens`）。安全快照与遗留明文迁移据此纳入统计——
 * 未注册的动态键会脱离安全快照（fallback/明文残留不可见）。
 */
export function registerSecureStoreDynamicItems(
  source: () => readonly SecureStoreDynamicItem[],
): () => void {
  dynamicItemSources.add(source)
  return () => {
    dynamicItemSources.delete(source)
  }
}

/** 静态登记项 + 各 owner 动态枚举项（按 key 去重；枚举异常不影响其余来源）。 */
export function listSecureStoreKnownItems(): readonly SecureStoreKnownItem[] {
  const items: SecureStoreKnownItem[] = [...SECURE_STORE_KNOWN_ITEMS]
  const seen = new Set(items.map((item) => item.key))
  for (const source of dynamicItemSources) {
    let dynamic: readonly SecureStoreDynamicItem[]
    try {
      dynamic = source()
    } catch {
      continue
    }
    for (const item of dynamic) {
      if (seen.has(item.key)) continue
      seen.add(item.key)
      items.push({ ...item })
    }
  }
  return items
}

export type SecureStoreSecuritySnapshot = {
  registeredCount: number
  fallbackValueCount: number
  legacyValueCount: number
  items: {
    id: string
    label: string
    owner: string
    key: string
    fallbackKey: string
    fallbackPresent: boolean
    legacyKey?: string
    legacyPresent: boolean
  }[]
}

const FALLBACK_PREFIX = "ideall:secure-fallback:"

function fallbackKey(key: string): string {
  return `${FALLBACK_PREFIX}${key}`
}

function storage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage
  } catch {
    return undefined
  }
}

async function invokeTauri<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(cmd, args)
}

export function secureFallbackStorageKey(key: string): string {
  return fallbackKey(key)
}

export function isSecureFallbackKey(key: string): boolean {
  return key.startsWith(FALLBACK_PREFIX)
}

export function secureFallbackGet(key: string): string | null {
  try {
    return storage()?.getItem(fallbackKey(key)) ?? null
  } catch {
    return null
  }
}

export function publicStorageGet(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null
  } catch {
    return null
  }
}

export function publicStorageRemove(key: string): void {
  try {
    storage()?.removeItem(key)
  } catch {
    /* ignore */
  }
}

export function publicStorageSet(key: string, value: string): void {
  try {
    storage()?.setItem(key, value)
  } catch {
    /* ignore */
  }
}

export function publicStorageGetWithLegacy(key: string, legacyKey: string): string | null {
  const value = publicStorageGet(key)
  const legacyValue = publicStorageGet(legacyKey)
  if (value !== null) {
    if (legacyValue !== null) publicStorageRemove(legacyKey)
    return value
  }
  if (legacyValue !== null) {
    publicStorageSet(key, legacyValue)
    publicStorageRemove(legacyKey)
    return legacyValue
  }
  return null
}

export function publicStorageRemoveWithLegacy(key: string, legacyKey: string): void {
  publicStorageRemove(key)
  publicStorageRemove(legacyKey)
}

export async function secureGetWithLegacy(key: string, legacyKey: string): Promise<string | null> {
  const value = await secureGet(key)
  const legacyValue = publicStorageGet(legacyKey)
  if (value !== null) {
    if (legacyValue !== null) publicStorageRemove(legacyKey)
    return value
  }
  if (legacyValue !== null) {
    await secureSet(key, legacyValue)
    publicStorageRemove(legacyKey)
    return legacyValue
  }
  return null
}

export function secureStoreSecuritySnapshot(
  items: readonly SecureStoreKnownItem[] = listSecureStoreKnownItems(),
): SecureStoreSecuritySnapshot {
  const inspected = items.map((item) => {
    const fallbackStorageKey = fallbackKey(item.key)
    const fallbackPresent = secureFallbackGet(item.key) !== null
    const legacyPresent = item.legacyKey ? publicStorageGet(item.legacyKey) !== null : false
    return {
      id: item.id,
      label: item.label,
      owner: item.owner,
      key: item.key,
      fallbackKey: fallbackStorageKey,
      fallbackPresent,
      legacyKey: item.legacyKey,
      legacyPresent,
    }
  })
  return {
    registeredCount: inspected.length,
    fallbackValueCount: inspected.filter((item) => item.fallbackPresent).length,
    legacyValueCount: inspected.filter((item) => item.legacyPresent).length,
    items: inspected,
  }
}

export async function secureStoreStatus(): Promise<SecureStoreStatus> {
  if (!isTauri()) return { backend: "web-localStorage", native: false }
  try {
    const status = await invokeTauri<{ backend: string; native: boolean }>("secure_store_status")
    return {
      backend:
        status.backend === "system-keychain" && status.native ? "system-keychain" : "unavailable",
      native: status.backend === "system-keychain" && status.native,
    }
  } catch (error) {
    return {
      backend: "unavailable",
      native: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function runSecureStoreSelfTest(): Promise<SecureStoreSelfTestResult> {
  if (!isTauri()) throw new Error("系统凭据库自检仅可在桌面 App 中运行")
  const result = await invokeTauri<{
    backend?: unknown
    roundTrip?: unknown
    cleanedUp?: unknown
  }>("secure_store_self_test")
  if (
    result.backend !== "system-keychain" ||
    result.roundTrip !== true ||
    result.cleanedUp !== true
  ) {
    throw new Error("系统凭据库自检返回了无效结果")
  }
  return { backend: "system-keychain", roundTrip: true, cleanedUp: true }
}

type SecureStoreMigrationInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

/**
 * 把已登记的旧 fallback/公开凭据迁入系统凭据库。每项必须写后读回成功才删除明文来源；
 * 原生库已有值时以原生值为真相，仅清理旧副本。返回值只含计数，不暴露 key/value。
 */
export async function migrateLegacySecureValues(
  options: Readonly<{
    native?: boolean
    invoke?: SecureStoreMigrationInvoke
  }> = {},
): Promise<SecureStoreMigrationResult> {
  // 整段迁移持**写者**锁执行，与全部 secure 写/删互斥（含并发 revoke/凭据轮转）。
  return withSecureRwLock(false, async () => {
    const native = options.native ?? isTauri()
    const invoke = options.invoke ?? invokeTauri
    const before = secureStoreSecuritySnapshot()
    const beforeRemaining = before.fallbackValueCount + before.legacyValueCount
    if (!native) {
      return {
        available: false,
        migrated: 0,
        removedPlaintext: 0,
        failed: 0,
        remaining: beforeRemaining,
      }
    }

    let migrated = 0
    let removedPlaintext = 0
    let failed = 0
    for (const item of listSecureStoreKnownItems()) {
      const fallbackValue = secureFallbackGet(item.key)
      const legacyValue = item.legacyKey ? publicStorageGet(item.legacyKey) : null
      if (fallbackValue === null && legacyValue === null) continue
      try {
        const current = await invoke<string | null>("secure_store_get", { key: item.key })
        if (current === null) {
          const source = fallbackValue ?? legacyValue
          if (source === null) continue
          await invoke<void>("secure_store_set", { key: item.key, value: source })
          const verified = await invoke<string | null>("secure_store_get", { key: item.key })
          if (verified !== source) throw new Error("secure-store migration verification failed")
          migrated += 1
        }
        if (fallbackValue !== null) {
          storage()?.removeItem(fallbackKey(item.key))
          removedPlaintext += 1
        }
        if (item.legacyKey && legacyValue !== null) {
          publicStorageRemove(item.legacyKey)
          removedPlaintext += 1
        }
      } catch {
        failed += 1
      }
    }
    const after = secureStoreSecuritySnapshot()
    return {
      available: true,
      migrated,
      removedPlaintext,
      failed,
      remaining: after.fallbackValueCount + after.legacyValueCount,
    }
  })
}

export async function secureGet(key: string): Promise<string | null> {
  if (isTauri()) {
    try {
      return await invokeTauri<string | null>("secure_store_get", { key })
    } catch {
      // App 形态绝不把旧的明文 fallback 当作凭据来源。状态页会单独报告后端故障，
      // 读取方只看到“无凭据”，从而 fail closed。
      return null
    }
  }
  return storage()?.getItem(fallbackKey(key)) ?? null
}

export async function secureSet(key: string, value: string): Promise<SecureStoreBackend> {
  // 读者锁：与其它 secure 写/删共享、与迁移互斥；Web 形态保持同步生效语义。
  return withSecureRwLock(true, async () => {
    if (isTauri()) {
      try {
        await invokeTauri<void>("secure_store_set", { key, value })
        storage()?.removeItem(fallbackKey(key))
        return "system-keychain"
      } catch (error) {
        throw new SecureStoreUnavailableError("write", error)
      }
    }
    storage()?.setItem(fallbackKey(key), value)
    return "web-localStorage"
  })
}

export async function secureDelete(key: string): Promise<void> {
  return withSecureRwLock(true, async () => {
    if (isTauri()) {
      try {
        await invokeTauri<void>("secure_store_delete", { key })
      } catch (error) {
        throw new SecureStoreUnavailableError("delete", error)
      }
    }
    storage()?.removeItem(fallbackKey(key))
  })
}
