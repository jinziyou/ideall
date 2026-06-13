/**
 * 后端 (super/server) API 基址 —— **同构** (web SSR 与 app 静态导出共用)。
 *
 * - 服务端 (SSR / Server Component / Server Action): 读 `SERVER_ADDR`
 *   (非 NEXT_PUBLIC_ 前缀, 不进客户端 bundle)。容器内由 compose 注入 `SERVER_ADDR=http://server:3001`。
 * - 客户端 (app 静态导出 / 浏览器直连 super/server): 读 `NEXT_PUBLIC_SERVER_ADDR` (构建期内联)。
 *
 * 故服务端优先 `SERVER_ADDR` (维持现有 web 行为); 客户端 `SERVER_ADDR` 为 undefined,
 * 自动回退到 `NEXT_PUBLIC_SERVER_ADDR`; 两者都缺则用本地开发默认。
 */
export const SERVER_ADDR: string =
  process.env.SERVER_ADDR ?? process.env.NEXT_PUBLIC_SERVER_ADDR ?? "http://127.0.0.1:3001"

/** super/server 的 `/info` 子路由前缀, info 模块所有取数的 base URL。 */
export const INFO_API_URI: string = `${SERVER_ADDR}/info`
