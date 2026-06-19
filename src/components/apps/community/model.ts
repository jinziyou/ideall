// community 领域类型 —— 由 myos 自有协议 `@protocol/server-port` 派生 (不再依赖 wonita 服务 wire DTO)。
export type { PublisherLocation, IpLocation } from "@protocol/server-port"

/** 是否成功定位: 经纬度为有限值且非 (0,0) 占位。发布者计数、地图绘制、访问者定位共用此判定, 保证口径一致。 */
export function isLocated(l: { longitude: number; latitude: number }): boolean {
  return (
    Number.isFinite(l.longitude) &&
    Number.isFinite(l.latitude) &&
    (l.longitude !== 0 || l.latitude !== 0)
  )
}
