// 浏览器收藏浮钮位置持久化 (窗口坐标, CSS 像素; 与 Rust browser_fab 对齐)。

const KEY = "ideall:browser-fab-pos"

export type BrowserFabPos = { fabX: number; fabY: number }

export function loadBrowserFabPos(): BrowserFabPos | null {
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as { fabX?: number; fabY?: number }
    if (typeof p.fabX === "number" && typeof p.fabY === "number") {
      return { fabX: p.fabX, fabY: p.fabY }
    }
  } catch {
    /* ignore */
  }
  return null
}

export function saveBrowserFabPos(fabX: number, fabY: number) {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(KEY, JSON.stringify({ fabX, fabY }))
  } catch {
    /* ignore */
  }
}
