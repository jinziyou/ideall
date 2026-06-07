// 同步码本地存取 (localStorage) —— 纯叶子, 无领域逻辑。
// 同步码即「跨端同步」的能力凭证; core (设备药丸 / 同步面板) 与 sync 插件共用。

const CODE_KEY = "wonita:sync:code"
const codeListeners = new Set<() => void>()

export function getSyncCode(): string | null {
  try {
    return localStorage.getItem(CODE_KEY)
  } catch {
    return null
  }
}

/** 订阅同步码变化 (供 useSyncExternalStore); 写入/清除时通知。 */
export function subscribeSyncCode(cb: () => void): () => void {
  codeListeners.add(cb)
  return () => {
    codeListeners.delete(cb)
  }
}

export function setSyncCode(code: string): void {
  try {
    localStorage.setItem(CODE_KEY, code)
  } catch {
    /* 隐私模式 / 配额: 忽略 */
  }
  codeListeners.forEach((l) => l())
}

export function clearSyncCode(): void {
  try {
    localStorage.removeItem(CODE_KEY)
  } catch {
    /* ignore */
  }
  codeListeners.forEach((l) => l())
}
