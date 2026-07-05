// 同步码本地存取 (localStorage) —— 纯叶子, 无领域逻辑。
// 同步码即「跨端同步」的能力凭证; core (设备标签 / 同步面板) 与 sync 插件共用。

export const SYNC_CODE_STORAGE_KEY = "wonita:sync:code"
const codeListeners = new Set<() => void>()

export function getSyncCode(): string | null {
  try {
    return localStorage.getItem(SYNC_CODE_STORAGE_KEY)
  } catch {
    return null
  }
}

/** 监听同步码变化 (供 useSyncExternalStore); 写入/清除时通知。 */
export function subscribeSyncCode(cb: () => void): () => void {
  codeListeners.add(cb)
  return () => {
    codeListeners.delete(cb)
  }
}

export function setSyncCode(code: string): void {
  try {
    localStorage.setItem(SYNC_CODE_STORAGE_KEY, code)
  } catch {
    /* 隐私模式 / 配额: 忽略 */
  }
  codeListeners.forEach((l) => l())
}

export function clearSyncCode(): void {
  try {
    localStorage.removeItem(SYNC_CODE_STORAGE_KEY)
  } catch {
    /* ignore */
  }
  codeListeners.forEach((l) => l())
}

// 跨标签页同步: 另一标签页写入/清除同步码后, 本页监听者 (设备标签 / 同步面板) 实时刷新。
// storage 事件只在其它标签页触发 (本页 set/clear 已手动 notify)。SSR 期无 window, 跳过。
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === null || e.key === SYNC_CODE_STORAGE_KEY) codeListeners.forEach((l) => l())
  })
}
