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

/** wonita 服务 v1 资源化契约的 base URL —— 所有端点 (articles/entities/auth/me/peers/sync…) 都挂在 `/v1` 下。 */
export const API_V1: string = `${SERVER_ADDR}/v1`
