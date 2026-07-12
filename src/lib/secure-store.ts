import { isTauri } from "./tauri"

export type SecureStoreBackend = "system-keychain" | "web-localStorage" | "localStorage-fallback"

export type SecureStoreStatus = {
  backend: SecureStoreBackend
  native: boolean
  error?: string
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
      backend: status.backend === "system-keychain" ? "system-keychain" : "localStorage-fallback",
      native: status.native,
    }
  } catch (error) {
    return {
      backend: "localStorage-fallback",
      native: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function secureGet(key: string): Promise<string | null> {
  if (isTauri()) {
    try {
      const value = await invokeTauri<string | null>("secure_store_get", { key })
      if (value !== null) return value
    } catch {
      return storage()?.getItem(fallbackKey(key)) ?? null
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
    } catch {
      storage()?.setItem(fallbackKey(key), value)
      return "localStorage-fallback"
    }
  }
  storage()?.setItem(fallbackKey(key), value)
  return "web-localStorage"
}

export async function secureDelete(key: string): Promise<void> {
  if (isTauri()) {
    try {
      await invokeTauri<void>("secure_store_delete", { key })
    } catch {
      /* fallback cleanup below */
    }
  }
  storage()?.removeItem(fallbackKey(key))
}
