// 发布者位置类型派生自 super/server 的 OpenAPI schema (src/lib/api/server.d.ts)。
// 改了 server 端模型, 重跑 `pnpm sync:api && pnpm gen:api` 同步。

import type { components } from "@/lib/api/server"

export type PublisherLocation = components["schemas"]["PublisherLocation"]

/** 是否成功定位: 经纬度为有限值且非 (0,0) 占位。page 计数与地图绘制共用此判定, 保证口径一致。 */
export function isLocated(l: PublisherLocation): boolean {
  return (
    Number.isFinite(l.longitude) &&
    Number.isFinite(l.latitude) &&
    (l.longitude !== 0 || l.latitude !== 0)
  )
}
