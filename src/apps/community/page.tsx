import { Map as MapIcon } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { AppHeader } from "@/components/app-header"
import { getPublisherLocations, getVisitorLocation } from "./action"
import { isLocated } from "./model"
import PublisherMap from "./publisher-map"
import PeerPublishers from "./peer-publishers"

// 服务端实时拉取发布者位置 + 访问者定位 (数据随采集持续变化, 不走静态化)。
export const dynamic = "force-dynamic"

export default async function Community() {
  // 发布者位置与访问者定位并行拉取; 只保留成功定位的来源, 让「已定位 N 个」计数与地图绘制点数一致。
  const [rawLocations, visitor] = await Promise.all([getPublisherLocations(), getVisitorLocation()])
  const locations = rawLocations.filter(isLocated)

  return (
    <main className="m-2 flex flex-col gap-4 sm:m-4">
      <AppHeader
        title="社区"
        dotClass="bg-spoke-community"
        description="看信息从哪里来、谁在发布 —— 订阅的发布者会回流到我的空间。"
      />
      <Card>
        <CardHeader>
          <CardTitle>发布者地图</CardTitle>
          <CardDescription>
            信息来源的地理分布 —— 点越大, 该来源的信息越多（已定位 {locations.length} 个来源）。
          </CardDescription>
          <p className="text-xs text-muted-foreground">
            联网才有 · 默认聚焦你所在城市, 可在地图上方切换其它城市或全国。
          </p>
        </CardHeader>
        <CardContent>
          {locations.length ? (
            <PublisherMap locations={locations} visitor={visitor} />
          ) : (
            <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-md bg-muted/30 text-sm text-muted-foreground">
              <MapIcon className="h-6 w-6" />
              还没有定位到发布者 —— 联网后, 来源的地理分布会出现在这里。
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>社区发布者</CardTitle>
          <CardDescription>
            订阅社区里的发布者（其他用户），其发布的内容会回流到「我的空间」的订阅流。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PeerPublishers />
        </CardContent>
      </Card>
    </main>
  )
}
