import { isTauri } from "./tauri"

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
  items = SECURE_STORE_KNOWN_ITEMS,
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
  for (const item of SECURE_STORE_KNOWN_ITEMS) {
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
}

export async function secureDelete(key: string): Promise<void> {
  if (isTauri()) {
    try {
      await invokeTauri<void>("secure_store_delete", { key })
    } catch (error) {
      throw new SecureStoreUnavailableError("delete", error)
    }
  }
  storage()?.removeItem(fallbackKey(key))
}
