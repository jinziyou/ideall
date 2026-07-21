import type { ServerPort } from "@protocol/server-port"
import { httpServerAdapter } from "./http-adapter"

let override: ServerPort | null = null

/** 注册替代后端；传入 null 可恢复官方 HTTP 适配器。 */
export function registerServerPort(port: ServerPort | null): void {
  override = port
}

/** 获取当前后端端口；SSR、静态预渲染和 App 运行时共享同一默认实现。 */
export function getServerPort(): ServerPort {
  return override ?? httpServerAdapter
}
