// community 数据访问 (同构: web SSR / app 静态导出客户端 共用)。
import { INFO_API_URI } from "@/components/lib/env"
import { apiFetch } from "@/components/lib/api"
import { PublisherLocation, IpLocation, isLocated } from "./model"

/** 拉取已定位的发布者位置; 失败时返回空数组让页面仍可渲染。 */
export async function getPublisherLocations(): Promise<PublisherLocation[]> {
  const result = await apiFetch<PublisherLocation[]>(`${INFO_API_URI}/publishers/locations`, {
    cache: "no-store",
    defaultErrorMessage: "获取发布者位置失败",
  })
  if (!result.ok) {
    console.error("[getPublisherLocations]", result.message)
    return []
  }
  return Array.isArray(result.data) ? result.data : []
}

/**
 * 访问者所在城市定位 (community 地图默认聚焦)。
 *
 * 调后端 `/info/geoip` (不带 ip): 服务端按请求来源 IP 定位 ——
 *   - Web: 经同源 `/api/backend` 代理转发, 代理透传 `cf-connecting-ip`/`x-real-ip`/`x-forwarded-for`,
 *     故服务端看到的是浏览器 IP 而非 Next 服务端 IP;
 *   - App: 直连后端, 由前置 Cloudflare 隧道注入来源 IP。
 * 定位失败 / 未定位 (经纬度 0 占位) → null, 地图回退「全国」视图, 用户可手动切换城市。
 */
export async function getVisitorLocation(): Promise<IpLocation | null> {
  const result = await apiFetch<IpLocation>(`${INFO_API_URI}/geoip`, {
    cache: "no-store",
    defaultErrorMessage: "访问者定位失败",
  })
  if (!result.ok) {
    console.error("[getVisitorLocation]", result.message)
    return null
  }
  const loc = result.data
  return loc && isLocated(loc) ? loc : null
}
