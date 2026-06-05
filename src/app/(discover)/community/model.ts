// 发布者位置类型派生自 super/server 的 OpenAPI schema (src/lib/api/server.d.ts)。
// 改了 server 端模型, 重跑 `pnpm sync:api && pnpm gen:api` 同步。

import type { components } from "@/lib/api/server"

export type PublisherLocation = components["schemas"]["PublisherLocation"]
export type IpLocation = components["schemas"]["IpLocation"]

/** 是否成功定位: 经纬度为有限值且非 (0,0) 占位。发布者计数、地图绘制、访问者定位共用此判定, 保证口径一致。 */
export function isLocated(l: { longitude: number; latitude: number }): boolean {
  return (
    Number.isFinite(l.longitude) &&
    Number.isFinite(l.latitude) &&
    (l.longitude !== 0 || l.latitude !== 0)
  )
}
