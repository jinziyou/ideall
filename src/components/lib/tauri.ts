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
 * 调用方须先自行做协议白名单校验 (见 `@/components/lib/safe-url` 的 `safeHref`)。
 */
export async function openExternalUrl(href: string): Promise<void> {
  const mod = await import("@tauri-apps/plugin-opener")
  await mod.openUrl(href)
}
