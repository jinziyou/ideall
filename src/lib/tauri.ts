// Tauri (App 形态) 集成 —— 集中所有 `@tauri-apps/plugin-*` 的惰性加载, 业务层只依赖本模块。
//
// ideall 仅以 Tauri App 分发 (静态导出 + webview)。webview 内有两处原生行为不可靠, 必须经插件绕过:
//   1. 直连后端 fetch 受 webview CORS 限制 (后端只放行 wonita.link Origin) → 经 tauri-plugin-http
//      (Rust 侧发请求) 绕过, 能力 `http:default` 已放行任意 http/https。
//   2. `window.open(url, "_blank")` 拉不起系统浏览器 / 在 webview 内替换自身 → 经 tauri-plugin-opener
//      的 `openUrl` 交给系统默认浏览器, 能力 `opener:default` 已放行。
//
// 纯浏览器 (`pnpm dev` 的 webview 加载源是 localhost) / SSR 预渲染期均无 `__TAURI_INTERNALS__`,
// 故全部退化为标准 `fetch` / `window.open`; 插件只在 App 形态惰性加载, 不进 web/SSR 主链路。

/** 当前运行在 Tauri App webview 内 (而非纯浏览器 / SSR 预渲染)。 */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
}

// tauri-plugin-http 的 fetch 惰性加载一次后缓存 (undefined=未尝试, null=加载失败回退标准 fetch)。
let _appFetch: typeof fetch | null | undefined

/**
 * 取一个能绕过 webview CORS 的 fetch。
 * App 形态返回 tauri-plugin-http 的 fetch (经 Rust 发请求, 不受 webview CORS 约束);
 * 纯浏览器 / SSR / 插件加载失败时回退标准 `fetch`。
 */
export async function resolveFetch(): Promise<typeof fetch> {
  if (!isTauri()) return fetch
  if (_appFetch !== undefined) return _appFetch ?? fetch
  try {
    const mod = await import("@tauri-apps/plugin-http")
    _appFetch = mod.fetch as unknown as typeof fetch
  } catch {
    _appFetch = null
  }
  return _appFetch ?? fetch
}

/**
 * App 形态: 经 tauri-plugin-opener 用系统默认浏览器打开外链 (webview 内 `window.open` 不可靠)。
 * 调用方须先自行做协议白名单校验 (见 `@/lib/safe-url` 的 `safeHref`)。
 */
export async function openExternalUrl(href: string): Promise<void> {
  const mod = await import("@tauri-apps/plugin-opener")
  await mod.openUrl(href)
}

/** agent 出站守卫取数结果 (Rust `agent_guarded_fetch` 命令的返回; 见 src-tauri/src/lib.rs)。 */
export interface AgentGuardedResponse {
  status: number
  finalUrl: string
  contentType: string | null
  location: string | null
  body: string
}

/**
 * App 形态: agent 联网 (web.search/web.fetch) 的出站取数经 Rust `agent_guarded_fetch` 命令 ——
 * 解析主机 → 校验**所有**解析 IP (任一落环回/私网/link-local/元数据即拒) → resolve_to_addrs **钉连**到已校验 IP
 * (reqwest 不再二次解析, 关闭 DNS-rebind/名解析 SSRF), 并在 Rust 侧做体积/超时/解压计数上限。**不**跟随重定向
 * (调用方逐跳复检, 每跳重走本命令即重解析+钉连)。仅在 `isTauri()` 为真时调用 (纯浏览器/SSR 无此命令)。
 */
export async function agentGuardedFetch(args: {
  url: string
  method?: string
  body?: string
  headers?: Record<string, string>
  maxBytes?: number
  timeoutMs?: number
}): Promise<AgentGuardedResponse> {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<AgentGuardedResponse>("agent_guarded_fetch", { args })
}

/** 主窗口内容区矩形 (CSS 像素, 相对窗口), 同步给内嵌浏览器子 webview。 */
export type BrowserBounds = {
  x: number
  y: number
  w: number
  h: number
  /** 收藏浮钮左上角 (可选, 持久化位置) */
  fabX?: number
  fabY?: number
}

async function tauriInvoke(cmd: string, args?: Record<string, unknown>): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core")
  await invoke(cmd, args)
}

// —— 内嵌浏览器 (路线 A): 主窗口控制原生子 webview; 全部经自定义命令, 外站子 webview 零授权。 ——
/** 打开内嵌浏览器子 webview, 加载 url, 定位到主窗口内容区 bounds (仅 Tauri 桌面)。 */
export function openBrowserView(url: string, bounds: BrowserBounds): Promise<void> {
  return tauriInvoke("open_browser_view", { url, b: bounds })
}
/** 同步子 webview 矩形 (内容区随窗口/侧栏变化时调用)。 */
export function browserSetBounds(bounds: BrowserBounds): Promise<void> {
  return tauriInvoke("browser_set_bounds", { b: bounds })
}
/** 地址栏导航。 */
export function browserNavigate(url: string): Promise<void> {
  return tauriInvoke("browser_navigate", { url })
}
export function browserBack(): Promise<void> {
  return tauriInvoke("browser_back")
}
export function browserForward(): Promise<void> {
  return tauriInvoke("browser_forward")
}
export function browserReload(): Promise<void> {
  return tauriInvoke("browser_reload")
}
export function browserHide(): Promise<void> {
  return tauriInvoke("browser_hide")
}
export function browserShow(): Promise<void> {
  return tauriInvoke("browser_show")
}
export function browserClose(): Promise<void> {
  return tauriInvoke("browser_close")
}

/** 监听内嵌浏览器当前 URL 变化 (on_navigation / on_page_load emit); 返回取消监听; 非 Tauri 为 no-op。 */
export async function onBrowserUrl(cb: (url: string) => void): Promise<() => void> {
  if (!isTauri()) return () => {}
  const { listen } = await import("@tauri-apps/api/event")
  return listen<string>("browser://url", (e) => cb(e.payload))
}

/** 监听原生收藏浮钮点击 (browser://favorite); 返回取消监听; 非 Tauri 为 no-op。 */
export async function onBrowserFavorite(cb: () => void): Promise<() => void> {
  if (!isTauri()) return () => {}
  const { listen } = await import("@tauri-apps/api/event")
  return listen("browser://favorite", () => cb())
}

export type BrowserFabMoved = { x: number; y: number }

/** 监听收藏浮钮拖拽结束 (browser://fab-moved); 返回取消监听; 非 Tauri 为 no-op。 */
export async function onBrowserFabMoved(cb: (pos: BrowserFabMoved) => void): Promise<() => void> {
  if (!isTauri()) return () => {}
  const { listen } = await import("@tauri-apps/api/event")
  return listen<BrowserFabMoved>("browser://fab-moved", (e) => cb(e.payload))
}
