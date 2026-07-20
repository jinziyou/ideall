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
