// 内嵌浏览器当前 URL 快照 (供 AI 助手上下文注入; 由 BrowserView 在导航/加载时更新)。

let currentUrl: string | null = null
const subscribers = new Set<() => void>()

/** 更新当前浏览器 URL (BrowserView 专用)。 */
export function setBrowserUrl(url: string): void {
  const u = url.trim()
  if (!u || u === currentUrl) return
  currentUrl = u
  for (const cb of subscribers) cb()
}

/** 当前浏览器 URL; 未打开浏览器标签或未导航过时为 null。 */
export function getBrowserUrl(): string | null {
  return currentUrl
}

export function subscribeBrowserUrl(cb: () => void): () => void {
  subscribers.add(cb)
  return () => subscribers.delete(cb)
}
