/**
 * 后端 (super/server) API 基址 —— **同构** (web SSR 与 app 静态导出共用)。
 *
 * - 服务端 (SSR / Route Handler): 读 `SERVER_ADDR` (容器内如 `http://host.docker.internal:5021`)。
 * - Web 浏览器: 走同源 `/api/backend` 代理 (见 `app/api/backend/[...path]/route.ts`),
 *   避免跨域与构建期内联占位 API 地址导致取数失败 (如生产域名)。
 * - App 静态导出: 客户端直连 `NEXT_PUBLIC_SERVER_ADDR` (无 Node 代理)。
 */
function clientWebProxyBase(): string | undefined {
  if (typeof window === "undefined") return undefined
  // App 静态导出无 Next.js 服务端, 不走路由代理 (NEXT_PUBLIC_BUILD_TARGET 由 next.config.ts appConfig 注入)
  if (process.env.NEXT_PUBLIC_BUILD_TARGET === "app") return undefined
  return `${window.location.origin}/api/backend`
}

export const SERVER_ADDR: string =
  process.env.SERVER_ADDR ??
  clientWebProxyBase() ??
  process.env.NEXT_PUBLIC_SERVER_ADDR ??
  "http://127.0.0.1:5021"

/** super/server 的 `/info` 子路由前缀, info 模块所有取数的 base URL。 */
export const INFO_API_URI: string = `${SERVER_ADDR}/info`
