"use client"

import { useEffect, useState } from "react"
import { Map as MapIcon, Loader2 } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { AppHeader } from "@/components/app-header"
import { getPublisherLocations, getVisitorLocation } from "./action"
import { isLocated, type PublisherLocation, type IpLocation } from "./model"
import PublisherMap from "./publisher-map"
import PeerPublishers from "./peer-publishers"

// 客户端实时拉取发布者位置 (数据随采集持续变化)。app 静态导出无服务端, 故在客户端取数。
export default function Community() {
  const [locations, setLocations] = useState<PublisherLocation[]>([])
  const [visitor, setVisitor] = useState<IpLocation | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    // 发布者位置与访问者定位并行拉取; 只保留成功定位的来源, 让「已定位 N 个」计数与地图绘制点数一致。
    Promise.all([getPublisherLocations(), getVisitorLocation()]).then(([raw, v]) => {
      if (!active) return
      setLocations(raw.filter(isLocated))
      setVisitor(v)
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [])

  return (
    <main className="m-2 flex flex-col gap-4 sm:m-4">
      <AppHeader title="社区" dotClass="bg-spoke-community" description="看信息从哪里来、谁在发布。" />
      <Card>
        <CardHeader>
          <CardTitle>发布者地图</CardTitle>
          <CardDescription>已定位 {locations.length} 个发布者，点越大信息越多。</CardDescription>
          <p className="text-xs text-muted-foreground">联网才有 · 可手动切换城市。</p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex h-64 items-center justify-center gap-2 rounded-md bg-muted/30 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              加载中…
            </div>
          ) : locations.length ? (
            <PublisherMap locations={locations} visitor={visitor} />
          ) : (
            <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-md bg-muted/30 text-sm text-muted-foreground">
              <MapIcon className="h-6 w-6" />
              还没有定位到发布者。联网后会出现在这里。
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>社区发布者</CardTitle>
          <CardDescription>订阅其他用户，其发布会回流到「我的」。</CardDescription>
        </CardHeader>
        <CardContent>
          <PeerPublishers />
        </CardContent>
      </Card>
    </main>
  )
}
