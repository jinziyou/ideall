// 登录会话本地存储 (token + 当前用户), localStorage; 供 useSyncExternalStore 监听。
// 这是公开发布身份, 与「跨端同步」的无账号同步码 (plugins/sync/lib/subscription-sync) 是两套独立身份。

import type { CurrentUser } from "./auth-api"

const TOKEN_KEY = "wonita:auth:token"
const USER_KEY = "wonita:auth:user"
const listeners = new Set<() => void>()

export type Session = { token: string; user: CurrentUser } | null

// 缓存快照引用: raw 不变则返回同一引用, 避免 useSyncExternalStore 抖动/死循环。
let cache: { tokenRaw: string | null; userRaw: string | null; value: Session } | null = null

export function getSession(): Session {
  let tokenRaw: string | null = null
  let userRaw: string | null = null
  try {
    tokenRaw = localStorage.getItem(TOKEN_KEY)
    userRaw = localStorage.getItem(USER_KEY)
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
  try {
    localStorage.setItem(TOKEN_KEY, token)
    localStorage.setItem(USER_KEY, JSON.stringify(user))
  } catch {
    /* 隐私模式 / 配额: 忽略 */
  }
  listeners.forEach((l) => l())
}

export function clearSession(): void {
  try {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l())
}

// 跨标签页同步: storage 事件只在「其它」标签页触发 (本页 set/clear 已手动 notify listeners)。
// 多窗口下另一标签页登录/登出后, 本页监听者 (account-menu / my-publications / sync-panel) 据此实时
// 刷新而非持续显示陈旧会话态。SSR 预渲染期无 window, 跳过。
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    // e.key 为 null = localStorage.clear(); 命中本模块 key 时失效快照缓存并通知。
    if (e.key === null || e.key === TOKEN_KEY || e.key === USER_KEY) {
      cache = null
      listeners.forEach((l) => l())
    }
  })
}
