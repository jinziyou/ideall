// community 取数 facade —— 经 `@protocol/server-port` 的 ServerPort (官方实现为 HTTP 适配器)。
import { getServerPort } from "@protocol/server-port"

/** 拉取已定位的发布者位置; 失败时返回空数组让页面仍可渲染。 */
export function getPublisherLocations() {
  return getServerPort().getPublisherLocations()
}

/**
 * 访问者所在城市定位 (community 地图默认聚焦)。调后端 `/info/geoip` (不带 ip),
 * 服务端按请求来源 IP 定位 (Web 经同源代理透传真实 IP, App 经 Cloudflare 隧道注入)。
 * 定位失败 / 未定位 (经纬度 0 占位) → null, 地图回退「全国」视图。
 */
export function getVisitorLocation() {
  return getServerPort().getVisitorLocation()
}
