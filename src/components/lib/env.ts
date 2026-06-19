/**
 * 后端 (wonita 服务) API 基址 —— **同构** (App 客户端运行期与 `pnpm dev` SSR 渲染期共用)。
 *
 * ideall 仅以 App 形态运行 (Tauri 静态导出, 无 Node 生产服务端):
 * - App 客户端 / 浏览器: 直连 `NEXT_PUBLIC_SERVER_ADDR` (构建期内联进静态包)。
 * - `pnpm dev` 的 SSR 渲染期 (供 Tauri 开发壳加载): 服务端读 `SERVER_ADDR`。
 *
 * 客户端直连后端需后端放行 CORS (见 docs/app.md); App 内 agent 经 tauri-plugin-http 绕过 CORS。
 */
export const SERVER_ADDR: string =
  process.env.SERVER_ADDR ??
  process.env.NEXT_PUBLIC_SERVER_ADDR ??
  "http://127.0.0.1:5021"

/** wonita 服务的 `/info` 子路由前缀, info 模块所有取数的 base URL。 */
export const INFO_API_URI: string = `${SERVER_ADDR}/info`
