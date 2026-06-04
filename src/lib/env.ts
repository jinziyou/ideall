/**
 * 服务端运行时配置 (server-only)。
 *
 * 只应在 Server Component / Server Action 中读取 —— 客户端组件读 `process.env` 会拿到 undefined。
 * 默认指向本地 super/server (开发); 容器内由 compose 注入 `APISERVER_ADDR=http://server:3001`。
 */
export const APISERVER_ADDR: string = process.env.APISERVER_ADDR ?? "http://127.0.0.1:3001"

/** super/server 的 `/info` 子路由前缀, info 模块所有取数的 base URL。 */
export const INFO_API_URI: string = `${APISERVER_ADDR}/info`
