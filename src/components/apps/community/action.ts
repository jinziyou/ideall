"use server"

import { headers } from "next/headers"
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
 * 是否为可对外定位的公网 IP。排除非 IP 占位串 ("unknown" 等)、回环、私网、链路本地、ULA ——
 * 这些既无定位意义, 本地直接判定回退全国, 省去一次无谓的后端往返。
 */
function isPublicIp(raw: string): boolean {
  // 去掉 IPv4-mapped 前缀 ::ffff: 后按 v4 判定
  const ip = raw.toLowerCase().replace(/^::ffff:/, "")
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    const [a, b] = ip.split(".").map(Number)
    if (ip.split(".").some((s) => Number(s) > 255)) return false
    if (a === 0 || a === 10 || a === 127 || a === 255) return false // 占位/私网/回环/广播
    if (a === 172 && b >= 16 && b <= 31) return false // 172.16.0.0/12
    if (a === 192 && b === 168) return false // 192.168.0.0/16
    if (a === 169 && b === 254) return false // 169.254.0.0/16 链路本地
    return true
  }
  // IPv6: 必须含冒号; 排除回环/未指定/ULA(fc/fd)/链路本地(fe80)
  if (!ip.includes(":")) return false
  if (ip === "::1" || ip === "::") return false
  if (ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80")) return false
  return true
}

/** 从请求头取访问者真实 IP: 优先 x-forwarded-for 首段 (经反代透传), 回退 x-real-ip; 仅返回公网 IP。 */
async function clientIp(): Promise<string | null> {
  const h = await headers()
  const xff = h.get("x-forwarded-for")
  const candidate = xff?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || ""
  return candidate && isPublicIp(candidate) ? candidate : null
}

/**
 * 定位访问者 IP 所在城市 (community 地图默认聚焦)。
 * 拿不到真实 IP (无反代 / 本地开发) 或定位失败时返回 null, 由地图回退全国视图。
 */
export async function getVisitorLocation(): Promise<IpLocation | null> {
  const ip = await clientIp()
  if (!ip) return null

  const params = new URLSearchParams({ ip })
  const result = await apiFetch<IpLocation>(`${INFO_API_URI}/geoip?${params.toString()}`, {
    cache: "no-store",
    defaultErrorMessage: "IP 定位失败",
  })
  if (!result.ok) {
    console.error("[getVisitorLocation]", result.message)
    return null
  }
  // 后端定位失败会返回经纬度 0 的占位 (或空 body → null), 统一收敛为 null
  return result.data && isLocated(result.data) ? result.data : null
}
