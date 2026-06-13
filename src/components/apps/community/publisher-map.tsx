"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import * as echarts from "echarts"
import { PublisherLocation, IpLocation } from "./model"
import { CityGroup, cityKey, groupByCity, pickDefaultCity } from "./cities"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

/**
 * 发布者地图: 在中国地图底图上用涟漪散点标出各信息发布者的地理位置, 点大小 = 信息条数。
 * 经纬度由 super/server 提供 (对发布者域名做 IP 地理定位)。
 *
 * 默认聚焦访问者所在城市 (visitor, 由 super/server 对访问者 IP 定位得到); 该城市无发布者数据
 * 或拿不到访问者定位时回退全国。地图上方下拉可切换到其它城市或切回全国。
 * 地图 geoJSON 来自仓库内自带的 /geo/china.json (无外部 CDN 运行时依赖), 注册后再 setOption。
 */

const ALL = "__all__" // 全国视图的 sentinel value
const CHINA_CENTER: [number, number] = [104, 36]
const CHINA_ZOOM = 1
const CITY_ZOOM = 10

/** 计算 geo 聚焦视图 (中心 + 缩放): 全国, 或指定城市的质心。 */
function viewFor(
  selected: string,
  cities: CityGroup[],
): { center: [number, number]; zoom: number } {
  if (selected !== ALL) {
    const c = cities.find((x) => x.city === selected)
    if (c) return { center: [c.longitude, c.latitude], zoom: CITY_ZOOM }
  }
  return { center: CHINA_CENTER, zoom: CHINA_ZOOM }
}

export default function PublisherMap({
  locations,
  visitor,
}: {
  locations: PublisherLocation[]
  visitor: IpLocation | null
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)
  const router = useRouter()

  // locations 已由调用方 (community/page.tsx) 经 isLocated 过滤, 此处不再二次过滤。
  const cities = useMemo(() => groupByCity(locations), [locations])

  // 默认聚焦访问者城市 (无定位 / 该城市无数据 → 全国); 惰性初始化, 仅首渲染算一次。
  const [selected, setSelected] = useState<string>(
    () => pickDefaultCity(cities, visitor)?.city ?? ALL,
  )
  // 数据刷新后选中城市可能从 cities 消失。渲染期直接收敛到合法值
  // (派生而非 effect 里 setState, 避免级联渲染 + Select 空白/视图文案不一致); ALL=全国恒合法。
  const activeCity =
    selected !== ALL && cities.some((c) => cityKey(c.city) === cityKey(selected)) ? selected : ALL
  // 给初始化 effect 读最新聚焦城市 (它不依赖 activeCity, 避免切城市重建图表); effect 内同步以免 render 期改 ref。
  const activeCityRef = useRef(activeCity)
  useEffect(() => {
    activeCityRef.current = activeCity
  }, [activeCity])

  // 图表就绪后视图 effect 才能 setOption (geoJSON 异步加载, 初始化在 await 之后)。
  const [ready, setReady] = useState(false)
  // 底图 (china.json) 加载失败时显占位, 不再继续初始化图表。
  const [loadFailed, setLoadFailed] = useState(false)

  // 1) 初始化图表: 底图 + 散点 + 点击/缩放交互。城市切换不重建 (见 effect 2)。
  useEffect(() => {
    if (!ref.current) return
    let chart: echarts.ECharts | null = null
    let disposed = false

    const points = locations.map((l) => ({
      name: l.name || l.domain,
      value: [l.longitude, l.latitude, l.count],
      domain: l.domain,
      city: l.city,
      country: l.country,
      count: l.count,
    }))
    const maxCount = points.reduce((m, p) => Math.max(m, p.count), 1)

    async function init() {
      let geo: Parameters<typeof echarts.registerMap>[1]
      try {
        const res = await fetch("/geo/china.json")
        if (!res.ok) throw new Error(`geo ${res.status}`)
        geo = await res.json()
      } catch {
        // 底图加载失败: 提示用户并显占位, 不抛出未捕获的 promise rejection。
        if (disposed) return
        toast.error("底图加载失败，请刷新重试")
        setLoadFailed(true)
        return
      }
      if (disposed || !ref.current) return
      echarts.registerMap("china", geo)
      chart = echarts.init(ref.current)
      const view = viewFor(activeCityRef.current, cities)
      chart.setOption({
        tooltip: {
          trigger: "item",
          // 窄屏: 限制 tooltip 在图表区域内, 长域名在图内换行, 避免越出视口触发横向滚动。
          confine: true,
          extraCssText: "max-width:100%;white-space:normal;word-break:break-all;",
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
          center: view.center,
          zoom: view.zoom,
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
        if (domain) router.push(`/info/publisher?domain=${encodeURIComponent(domain)}`)
      })

      chartRef.current = chart
      setReady(true)
    }
    init()

    const onResize = () => chart?.resize()
    window.addEventListener("resize", onResize)
    return () => {
      disposed = true
      window.removeEventListener("resize", onResize)
      chart?.dispose()
      chartRef.current = null
      setReady(false)
      setLoadFailed(false)
    }
  }, [locations, cities, router])

  // 2) 切换聚焦城市 → 仅更新 geo 中心/缩放 (带动画), 不重建图表。
  useEffect(() => {
    if (!ready || !chartRef.current) return
    const view = viewFor(activeCity, cities)
    chartRef.current.setOption({ geo: { center: view.center, zoom: view.zoom } })
  }, [activeCity, ready, cities])

  return (
    <div className="flex flex-col gap-3">
      {cities.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">聚焦</span>
          <Select value={activeCity} onValueChange={setSelected}>
            <SelectTrigger className="h-9 w-[200px]">
              <SelectValue placeholder="全国" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>全国</SelectItem>
              {cities.map((c) => (
                <SelectItem key={c.city} value={c.city}>
                  {c.city}（{c.count}）
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="relative h-[min(480px,75dvh)] w-full sm:h-[min(600px,80dvh)]">
        <div ref={ref} className="h-full w-full" />
        {loadFailed && (
          <div className="absolute inset-0 flex items-center justify-center text-center text-sm text-muted-foreground">
            底图加载失败，请刷新重试。
          </div>
        )}
      </div>
    </div>
  )
}
