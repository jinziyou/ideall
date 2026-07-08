// 外部资源统一入口: 桌面 App 把任意外链 (https://…) 交给「浏览器」模块; 插件 SPA 内的相对路由不在此处理。
// 产品定位: 资讯 / 社区 = 嵌入 SPA 插件 (wonita/portal iframe); 浏览器 = 外部网页资源。
// 触发方: 插件 host.openExternal、宿主 UI 的 openExternal、全局 target=_blank 拦截。
import { isTauri, browserNavigate } from "@/lib/tauri"
import { safeHref } from "@/lib/safe-url"
import { openTab } from "./store"
import { tabDescriptor } from "./tab-definitions"

const BROWSER_TAB = tabDescriptor("browser-view")

let pendingUrl: string | null = null
const subscribers = new Set<(url: string) => void>()

/** BrowserView 首次挂载时取走待打开 URL (若有)。 */
export function takePendingBrowserUrl(): string | null {
  const u = pendingUrl
  pendingUrl = null
  return u
}

/** 已挂载的 BrowserView 订阅后续外链 (标签已开、仅导航)。 */
export function subscribePendingBrowserUrl(cb: (url: string) => void): () => void {
  subscribers.add(cb)
  return () => subscribers.delete(cb)
}

/**
 * 桌面 App: 把外链交给「浏览器」模块加载; 纯网页形态一律回退新标签 window.open。
 * newTab=true (默认) 开/切到浏览器标签再导航; newTab=false 只在已打开的浏览器内导航 (不开新标签)。
 */
export async function navigateExternal(
  url: string,
  { newTab = true }: { newTab?: boolean } = {},
): Promise<void> {
  const href = safeHref(url)
  if (!href) return

  if (!isTauri()) {
    window.open(href, "_blank", "noopener,noreferrer")
    return
  }

  if (newTab) {
    pendingUrl = href
    openTab(BROWSER_TAB)
  }

  try {
    await browserNavigate(href)
    if (newTab) pendingUrl = null
  } catch {
    if (newTab) for (const cb of subscribers) cb(href)
  }
}

/** 外链 → 新「浏览器」标签 (= navigateExternal 默认 newTab)。 */
export async function openInBrowserTab(url: string): Promise<void> {
  return navigateExternal(url, { newTab: true })
}
