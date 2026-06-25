// 外部 / 跨用户来源的 URL 在渲染成 <a href> 或 window.open 前必须做协议白名单:
// React 不会拦截 href 中的 javascript:/data: 等伪协议, 跨用户内容 (订阅的他人 peer
// 发布、被投毒的爬取链接、模型给的书签 URL) 一旦含此类 URL, 受害者点击即在本站
// origin 执行脚本, 可窃取 localStorage 中的 auth token 与同步码 (存储型 XSS)。

import { isTauri, openExternalUrl } from "@/lib/tauri"

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"])

/**
 * 校验外部 URL 协议安全, 安全则原样返回, 否则返回 undefined。
 * 用法: `<a href={safeHref(url)}>` —— undefined 时 anchor 不可点 (退化为纯文本链接)。
 */
export function safeHref(url: string | null | undefined): string | undefined {
  if (!url || typeof url !== "string") return undefined
  try {
    const u = new URL(url)
    return ALLOWED_PROTOCOLS.has(u.protocol) ? url : undefined
  } catch {
    return undefined // 相对路径 / 非法 URL 不作为外链处理
  }
}

/**
 * 安全打开外链: 先过协议白名单, 再按形态分流:
 *   - App (Tauri): 经 opener 插件交给系统默认浏览器 (webview 内 `window.open(_blank)` 不可靠);
 *   - 纯浏览器: `window.open(_blank)` + 强制 noopener,noreferrer (防反向 tabnabbing)。
 * 非法协议则忽略。
 */
export function openExternal(url: string | null | undefined): void {
  const href = safeHref(url)
  if (!href) return
  if (isTauri()) {
    // 失败 (插件未就绪等) 兜底回退 window.open, 不让外链彻底打不开。
    openExternalUrl(href).catch((e) => {
      console.error("[openExternal] 系统浏览器打开失败, 回退 window.open:", e)
      window.open(href, "_blank", "noopener,noreferrer")
    })
    return
  }
  window.open(href, "_blank", "noopener,noreferrer")
}

/**
 * App (Tauri) 形态: 全局拦截 `<a target="_blank">` 外链点击, 改经系统浏览器打开
 * (webview 内原生新窗口不可靠)。覆盖全站现有及未来的外链锚点, 免去逐处改造。
 * 仅左键、未被 preventDefault、href 过协议白名单者拦截; 纯浏览器 / SSR 为 no-op。
 * 返回卸载函数 (供 effect 清理)。
 *
 * 关键: 监听挂在 document 的**捕获阶段** (第三参 true)。React 的合成事件委托在根容器
 * (低于 document) 触发, 锚点 onClick 里的 `e.stopPropagation()` 会在冒泡阶段切断原生事件,
 * 使 document 上的冒泡监听收不到 (如 cells 的百科/维基外链就带 stopPropagation)。捕获阶段
 * 自上而下先于 React 与冒泡 stopPropagation 执行, 故不会被绕过。
 */
export function installTauriExternalLinks(): () => void {
  if (!isTauri() || typeof document === "undefined") return () => {}
  const onClick = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0) return
    const target = e.target as Element | null
    const anchor = target?.closest?.('a[target="_blank"]') as HTMLAnchorElement | null
    if (!anchor) return
    // 读 authored href (而非已解析的 .href): 内部相对路由不会误判为外链 (safeHref 拒绝相对路径)。
    const href = safeHref(anchor.getAttribute("href"))
    if (!href) return
    e.preventDefault()
    openExternal(href)
  }
  document.addEventListener("click", onClick, true)
  return () => document.removeEventListener("click", onClick, true)
}
