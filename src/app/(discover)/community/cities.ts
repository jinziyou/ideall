// community 地图的城市聚合 / 默认聚焦选择 (纯函数, 无副作用)。
// 城市名沿用后端 ip-api 反查的原始值 (多为英文专名), 与地图 tooltip 口径一致。

import { PublisherLocation, IpLocation, isLocated } from "./model"

/** 一个城市的发布者聚合: 数量 + 质心坐标 (用于地图聚焦)。 */
export interface CityGroup {
  city: string
  count: number
  longitude: number
  latitude: number
}

/** 规范化城市名做匹配: 去空白 + 小写 (容忍 ip-api 与访问者定位的大小写/空格差异)。 */
export function cityKey(city: string): string {
  return city.trim().toLowerCase()
}

/** 把已定位的发布者按城市聚合, 质心取该城市各点坐标的均值; 按发布者数降序、同数按城市名升序。 */
export function groupByCity(locations: PublisherLocation[]): CityGroup[] {
  const acc = new Map<string, { city: string; count: number; lon: number; lat: number }>()
  for (const l of locations) {
    if (!isLocated(l)) continue
    const city = l.city?.trim()
    if (!city) continue
    const key = cityKey(city)
    const cur = acc.get(key)
    if (cur) {
      cur.count += 1
      cur.lon += l.longitude
      cur.lat += l.latitude
    } else {
      acc.set(key, { city, count: 1, lon: l.longitude, lat: l.latitude })
    }
  }
  return Array.from(acc.values())
    .map((g) => ({
      city: g.city,
      count: g.count,
      longitude: g.lon / g.count,
      latitude: g.lat / g.count,
    }))
    .sort((a, b) => b.count - a.count || a.city.localeCompare(b.city))
}

/**
 * 阈值 (度, ~111km/度): 城市名匹配失败时, 仅当最近城市质心在此距离内才聚焦它。
 * 取 0.5° (~55km) 收紧到"同城/同都市圈"量级——只为容忍 ip-api 对同一地点的城市名差异,
 * 避免把明显不同的邻市误判为访问者所在城市 (与 Q2「无数据回退全国」的口径对齐)。
 */
const NEAR_DEG = 0.5

/**
 * 选出地图默认聚焦的城市:
 *   1) 访问者城市名能匹配到有数据的城市 → 用它;
 *   2) 否则取距访问者最近且在阈值内的城市 (容忍同一地点的城市名格式差异);
 *   3) 都没有 (访问者无定位 / 该城市无发布者) → null, 调用方回退全国。
 */
export function pickDefaultCity(cities: CityGroup[], visitor: IpLocation | null): CityGroup | null {
  if (!visitor || !isLocated(visitor) || cities.length === 0) return null

  const key = cityKey(visitor.city ?? "")
  if (key) {
    const byName = cities.find((c) => cityKey(c.city) === key)
    if (byName) return byName
  }

  let nearest: CityGroup | null = null
  let best = Infinity
  for (const c of cities) {
    const dLon = c.longitude - visitor.longitude
    const dLat = c.latitude - visitor.latitude
    const d2 = dLon * dLon + dLat * dLat
    if (d2 < best) {
      best = d2
      nearest = c
    }
  }
  return nearest && best <= NEAR_DEG * NEAR_DEG ? nearest : null
}
