"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import * as echarts from "echarts"
import { PublisherLocation, isLocated } from "./model"

/**
 * 发布者地图: 在中国地图底图上用涟漪散点标出各信息发布者的地理位置, 点大小 = 信息条数。
 * 经纬度来自 super/server 对发布者域名做 IP 地理定位 (缓存在 Neo4j Website 节点)。
 *
 * 地图 geoJSON 来自仓库内自带的 /geo/china.json (无外部 CDN 运行时依赖), 注册后再 setOption。
 */
export default function PublisherMap({ locations }: { locations: PublisherLocation[] }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const router = useRouter()

  useEffect(() => {
    if (!ref.current) return
    let chart: echarts.ECharts | null = null
    let disposed = false

    const points = locations.filter(isLocated).map((l) => ({
      name: l.name || l.domain,
      value: [l.longitude, l.latitude, l.count],
      domain: l.domain,
      city: l.city,
      country: l.country,
      count: l.count,
    }))
    const maxCount = points.reduce((m, p) => Math.max(m, p.count), 1)

    async function init() {
      const geo = await fetch("/geo/china.json").then((r) => r.json())
      if (disposed || !ref.current) return
      echarts.registerMap("china", geo)
      chart = echarts.init(ref.current)
      chart.setOption({
        tooltip: {
          trigger: "item",
          formatter: (p: {
            name: string
            data?: { domain?: string; city?: string; country?: string; count?: number }
          }) => {
            const d = p.data ?? {}
            const where = d.city || d.country
            const place = where ? `${where} · ` : ""
            return `<b>${p.name}</b><br/>${d.domain ?? ""}<br/>${place}${d.count ?? 0} 条<br/><span style="color:#3b82f6">点击查看该发布者</span>`
          },
        },
        geo: {
          map: "china",
          roam: true,
          itemStyle: { areaColor: "#f1f5f9", borderColor: "#cbd5e1" },
          emphasis: { itemStyle: { areaColor: "#e2e8f0" }, label: { show: false } },
        },
        series: [
          {
            name: "发布者",
            type: "effectScatter",
            coordinateSystem: "geo",
            data: points,
            symbolSize: (val: number[]) => 6 + (val[2] / maxCount) * 22,
            rippleEffect: { brushType: "stroke" },
            itemStyle: { color: "#3b82f6", shadowBlur: 6, shadowColor: "#3b82f6" },
            emphasis: { scale: 1.3 },
          },
        ],
      })

      // 点击散点 → 跳到该发布者页 (在那里可订阅), 把社区地图接回「发现 → 订阅」闭环。
      chart.on("click", (params) => {
        const domain = (params as { data?: { domain?: string } }).data?.domain
        if (domain) router.push(`/info/publisher/${encodeURIComponent(domain)}`)
      })
    }
    init()

    const onResize = () => chart?.resize()
    window.addEventListener("resize", onResize)
    return () => {
      disposed = true
      window.removeEventListener("resize", onResize)
      chart?.dispose()
    }
  }, [locations, router])

  return <div ref={ref} className="h-[480px] w-full sm:h-[600px]" />
}
