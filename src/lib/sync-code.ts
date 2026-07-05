// 同步码本地存取 —— 同步码是能力凭证, 明文只允许落在 secure-store 端口。
// 同步码即「跨端同步」的能力凭证; core (设备标签 / 同步面板) 与 sync 插件共用。

import {
  LEGACY_PUBLIC_STORAGE_KEYS,
  SECURE_STORE_KEYS,
  publicStorageRemove,
  secureDelete,
  secureFallbackStorageKey,
  secureGetWithLegacy,
  secureMigrateLegacyValueSync,
  secureSet,
} from "@/lib/secure-store"

export const SYNC_CODE_STORAGE_KEY = LEGACY_PUBLIC_STORAGE_KEYS.SYNC_CODE
export const SYNC_CODE_SECURE_KEY = SECURE_STORE_KEYS.SYNC_CODE
const codeListeners = new Set<() => void>()
let cachedCode: string | null = null
let hydrated = false
let hydrating: Promise<string | null> | null = null

function notify() {
  codeListeners.forEach((l) => l())
}

function readSyncCodeSync(): string | null {
  const value = secureMigrateLegacyValueSync(SYNC_CODE_SECURE_KEY, SYNC_CODE_STORAGE_KEY)
  if (value !== null) {
    cachedCode = value
    hydrated = true
    return value
  }
  return cachedCode
}

export async function hydrateSyncCodeSecure(): Promise<string | null> {
  if (hydrating) return hydrating
  hydrating = secureGetWithLegacy(SYNC_CODE_SECURE_KEY, SYNC_CODE_STORAGE_KEY)
    .then((value) => {
      cachedCode = value
      hydrated = true
      notify()
      return value
    })
    .finally(() => {
      hydrating = null
    })
  return hydrating
}

export function getSyncCode(): string | null {
  const syncValue = readSyncCodeSync()
  if (!hydrated) void hydrateSyncCodeSecure()
  return syncValue
}

/** 监听同步码变化 (供 useSyncExternalStore); 写入/清除时通知。 */
export function subscribeSyncCode(cb: () => void): () => void {
  codeListeners.add(cb)
  return () => {
    codeListeners.delete(cb)
  }
}

export function setSyncCode(code: string): void {
  cachedCode = code
  hydrated = true
  publicStorageRemove(SYNC_CODE_STORAGE_KEY)
  void secureSet(SYNC_CODE_SECURE_KEY, code)
  notify()
}

export function clearSyncCode(): void {
  cachedCode = null
  hydrated = true
  publicStorageRemove(SYNC_CODE_STORAGE_KEY)
  void secureDelete(SYNC_CODE_SECURE_KEY)
  notify()
}

// 跨标签页同步: 另一标签页写入/清除同步码后, 本页监听者 (设备标签 / 同步面板) 实时刷新。
// storage 事件只在其它标签页触发 (本页 set/clear 已手动 notify)。SSR 期无 window, 跳过。
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (
      e.key === null ||
      e.key === SYNC_CODE_STORAGE_KEY ||
      e.key === secureFallbackStorageKey(SYNC_CODE_SECURE_KEY)
    ) {
      cachedCode = secureMigrateLegacyValueSync(SYNC_CODE_SECURE_KEY, SYNC_CODE_STORAGE_KEY)
      hydrated = cachedCode !== null
      if (!hydrated) void hydrateSyncCodeSecure()
      notify()
    }
  })
}
