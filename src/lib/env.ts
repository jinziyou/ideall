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
  process.env.SERVER_ADDR ?? process.env.NEXT_PUBLIC_SERVER_ADDR ?? "https://api.wonita.link"

/** wonita V2 App API：鉴权、资料、社区发布与账户目录。 */
export const API_V2_APP: string = `${SERVER_ADDR}/v2/app`

/** wonita V2 Data API：可匿名直连的 corpus / graph / catalog 公共读端点。 */
export const API_V2_DATA: string = `${SERVER_ADDR}/v2/data`

/**
 * wonita V1 base URL。仅供尚未迁移的兼容边界使用；新 ServerPort 业务不得再从这里增加
 * auth/community/data 调用。
 */
export const API_V1: string = `${SERVER_ADDR}/v1`
