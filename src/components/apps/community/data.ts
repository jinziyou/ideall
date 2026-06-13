// community 数据访问 (同构: web SSR / app 静态导出客户端 共用)。
import { INFO_API_URI } from "@/components/lib/env"
import { apiFetch } from "@/components/lib/api"
import { PublisherLocation, IpLocation } from "./model"

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
 * 客户端直连后端架构下, 浏览器 / App 无法读取自身公网 IP（原 SSR 版从反代 `x-forwarded-for` 取），
 * 故当前返回 null —— 地图回退「全国」视图, 用户可手动切换城市。
 * 后续若后端 `/info/geoip` 支持「ip 省略时按请求来源 IP 定位」, 即可改为直接调用恢复自动聚焦。
 */
export async function getVisitorLocation(): Promise<IpLocation | null> {
  return null
}
