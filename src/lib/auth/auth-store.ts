// 登录会话本地存储。token 是能力凭证, 走 secure-store; 当前用户资料只作 UI 展示, 仍在 localStorage。
// 这是公开发布身份, 与「跨端同步」的无账号同步码 (plugins/sync/lib/subscription-sync) 是两套独立身份。

import type { CurrentUser } from "./auth-api"
import {
  LEGACY_PUBLIC_STORAGE_KEYS,
  SECURE_STORE_KEYS,
  publicStorageGetWithLegacy,
  publicStorageRemove,
  publicStorageRemoveWithLegacy,
  publicStorageSet,
  secureDelete,
  secureFallbackGet,
  secureFallbackStorageKey,
  secureGetWithLegacy,
  secureSet,
} from "@/lib/secure-store"

export const AUTH_TOKEN_STORAGE_KEY = LEGACY_PUBLIC_STORAGE_KEYS.AUTH_TOKEN
export const AUTH_TOKEN_SECURE_KEY = SECURE_STORE_KEYS.AUTH_TOKEN
export const AUTH_USER_STORAGE_KEY = "ideall:auth:user"
export const LEGACY_AUTH_USER_STORAGE_KEY = "wonita:auth:user"
const listeners = new Set<() => void>()

export type Session = { token: string; user: CurrentUser } | null

// 缓存快照引用: raw 不变则返回同一引用, 避免 useSyncExternalStore 抖动/死循环。
let cache: { tokenRaw: string | null; userRaw: string | null; value: Session } | null = null
let cachedTokenRaw: string | null = null
let tokenHydrated = false
let tokenHydrating: Promise<string | null> | null = null

function notify() {
  listeners.forEach((l) => l())
}

function readTokenSync(): string | null {
  return secureFallbackGet(AUTH_TOKEN_SECURE_KEY) ?? cachedTokenRaw
}

export async function hydrateSessionTokenSecure(): Promise<string | null> {
  if (tokenHydrating) return tokenHydrating
  tokenHydrating = secureGetWithLegacy(AUTH_TOKEN_SECURE_KEY, AUTH_TOKEN_STORAGE_KEY)
    .then((value) => {
      cachedTokenRaw = value
      tokenHydrated = true
      cache = null
      notify()
      return value
    })
    .finally(() => {
      tokenHydrating = null
    })
  return tokenHydrating
}

export function getSession(): Session {
  const tokenRaw = readTokenSync()
  let userRaw: string | null = null
  try {
    userRaw = publicStorageGetWithLegacy(AUTH_USER_STORAGE_KEY, LEGACY_AUTH_USER_STORAGE_KEY)
  } catch {
    return null
  }
  if (cache && cache.tokenRaw === tokenRaw && cache.userRaw === userRaw) return cache.value
  let value: Session = null
  if (tokenRaw && userRaw) {
    try {
      value = { token: tokenRaw, user: JSON.parse(userRaw) as CurrentUser }
    } catch {
      value = null
    }
  }
  cache = { tokenRaw, userRaw, value }
  return value
}

export function subscribeSession(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function setSession(token: string, user: CurrentUser): void {
  cachedTokenRaw = token
  tokenHydrated = true
  cache = null
  publicStorageSet(AUTH_USER_STORAGE_KEY, JSON.stringify(user))
  publicStorageRemove(LEGACY_AUTH_USER_STORAGE_KEY)
  publicStorageRemove(AUTH_TOKEN_STORAGE_KEY)
  void secureSet(AUTH_TOKEN_SECURE_KEY, token)
  notify()
}

export function clearSession(): void {
  cachedTokenRaw = null
  tokenHydrated = true
  cache = null
  publicStorageRemoveWithLegacy(AUTH_USER_STORAGE_KEY, LEGACY_AUTH_USER_STORAGE_KEY)
  publicStorageRemove(AUTH_TOKEN_STORAGE_KEY)
  void secureDelete(AUTH_TOKEN_SECURE_KEY)
  notify()
}

// 跨标签页同步: storage 事件只在「其它」标签页触发 (本页 set/clear 已手动 notify listeners)。
// 多窗口下另一标签页登录/登出后, 本页监听者 (account-menu / my-publications / sync-panel) 据此实时
// 刷新而非持续显示陈旧会话态。SSR 预渲染期无 window, 跳过。
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    // e.key 为 null = localStorage.clear(); 命中本模块 key 时失效快照缓存并通知。
    if (
      e.key === null ||
      e.key === AUTH_TOKEN_STORAGE_KEY ||
      e.key === secureFallbackStorageKey(AUTH_TOKEN_SECURE_KEY) ||
      e.key === AUTH_USER_STORAGE_KEY ||
      e.key === LEGACY_AUTH_USER_STORAGE_KEY
    ) {
      if (e.key === AUTH_USER_STORAGE_KEY || e.key === LEGACY_AUTH_USER_STORAGE_KEY) {
        cache = null
        notify()
        return
      }
      if (e.key === AUTH_TOKEN_STORAGE_KEY) {
        void hydrateSessionTokenSecure()
        return
      }
      if (e.key === null) {
        cachedTokenRaw = null
        tokenHydrated = false
        cache = null
        void hydrateSessionTokenSecure()
        notify()
        return
      }
      if (e.key === secureFallbackStorageKey(AUTH_TOKEN_SECURE_KEY)) {
        cachedTokenRaw = secureFallbackGet(AUTH_TOKEN_SECURE_KEY)
        tokenHydrated = true
        cache = null
        notify()
      }
    }
  })
}
