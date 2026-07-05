import { isTauri } from "./tauri"

export type SecureStoreBackend = "system-keychain" | "web-localStorage" | "localStorage-fallback"

export type SecureStoreStatus = {
  backend: SecureStoreBackend
  native: boolean
  error?: string
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
