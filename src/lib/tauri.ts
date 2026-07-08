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

/**
 * Windows: 原生子 webview (HWND) 叠在主界面之上, bounds 异常时会挡全窗。
 * 由 browser_present 原子 set_bounds + show, 并在 bounds 非法时 browserClose 释放。
 */

/** 收起并销毁原生子 webview (切标签 / 异常 bounds 时清场)。 */
export function browserRelease(): Promise<void> {
  return browserClose()
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
/** 同步 bounds 并显示子 webview (原子操作, 避免 Windows HWND 全窗遮挡)。 */
export function browserPresent(bounds: BrowserBounds): Promise<void> {
  return tauriInvoke("browser_present", { b: bounds })
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

/** 内嵌浏览器后端信息 (CDP / WebKit / WebView)。 */
export interface BrowserBackendInfo {
  mode: "cdp" | "webkit" | "webview"
  cdpAvailable: boolean
  running: boolean
  chromePath: string | null
}

export async function browserGetBackend(): Promise<BrowserBackendInfo> {
  if (!isTauri()) throw new Error("仅桌面 App 可用")
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<BrowserBackendInfo>("browser_get_backend")
}

/** 内嵌浏览器当前页快照 (仅 Tauri 桌面; 浏览器标签须已打开)。 */
export interface BrowserPageContent {
  url: string
  title: string
  text: string
}

export async function browserGetPageContent(): Promise<BrowserPageContent> {
  if (!isTauri()) throw new Error("仅桌面 App 可用")
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<BrowserPageContent>("browser_get_content")
}

/** 点击内嵌浏览器页面元素 (CSS 选择器)。 */
export async function browserClick(selector: string): Promise<void> {
  if (!isTauri()) throw new Error("仅桌面 App 可用")
  const { invoke } = await import("@tauri-apps/api/core")
  await invoke("browser_click", { selector })
}

/** 向内嵌浏览器输入框填写内容 (CSS 选择器 + 文本)。 */
export async function browserFill(selector: string, text: string): Promise<void> {
  if (!isTauri()) throw new Error("仅桌面 App 可用")
  const { invoke } = await import("@tauri-apps/api/core")
  await invoke("browser_fill", { selector, text })
}

/** 向当前焦点元素发送按键 (Enter / Tab / 单字符等)。 */
export async function browserPress(key: string): Promise<void> {
  if (!isTauri()) throw new Error("仅桌面 App 可用")
  const { invoke } = await import("@tauri-apps/api/core")
  await invoke("browser_press", { key })
}

/** 可交互元素 (browser.listInteractive)。 */
export interface BrowserInteractiveElement {
  ref: number
  role: string
  name: string
  selector: string
  tag: string
  type?: string
}

export interface BrowserInteractiveResult {
  url: string
  title: string
  elements: BrowserInteractiveElement[]
}

/** 列出当前页可交互元素 (按钮/链接/输入框 + 建议 CSS 选择器)。 */
export async function browserListInteractive(): Promise<BrowserInteractiveResult> {
  if (!isTauri()) throw new Error("仅桌面 App 可用")
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<BrowserInteractiveResult>("browser_list_interactive")
}

/** 等待若干毫秒 (操作后让页面加载)。 */
export async function browserWait(ms: number): Promise<void> {
  if (!isTauri()) throw new Error("仅桌面 App 可用")
  const { invoke } = await import("@tauri-apps/api/core")
  await invoke("browser_wait", { ms })
}

/** 等待页面出现匹配选择器的元素。 */
export async function browserWaitForSelector(selector: string, timeoutMs?: number): Promise<void> {
  if (!isTauri()) throw new Error("仅桌面 App 可用")
  const { invoke } = await import("@tauri-apps/api/core")
  await invoke("browser_wait_for_selector", { selector, timeoutMs })
}

/** 窗控最大化/还原 (WSL 下铺满主屏 work area)。返回最大化后是否为「已最大化」态。 */
export async function windowToggleMaximize(): Promise<boolean> {
  if (!isTauri()) return false
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<boolean>("window_toggle_maximize")
}

/** 窗控最大化图标状态 (含 WSL 伪最大化)。 */
export async function windowQueryMaximized(): Promise<boolean> {
  if (!isTauri()) return false
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<boolean>("window_query_maximized")
}

/** 监听内嵌浏览器当前 URL 变化 (on_navigation / on_page_load emit); 返回取消监听; 非 Tauri 为 no-op。 */
export async function onBrowserUrl(cb: (url: string) => void): Promise<() => void> {
  if (!isTauri()) return () => {}
  const { listen } = await import("@tauri-apps/api/event")
  return listen<string>("browser://url", (e) => cb(e.payload))
}
