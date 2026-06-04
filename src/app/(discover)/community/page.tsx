import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getPublisherLocations } from "./action"
import { isLocated } from "./model"
import PublisherMap from "./publisher-map"
import PeerPublishers from "./peer-publishers"

// 服务端实时拉取发布者位置 (数据随采集持续变化, 不走静态化)。
export const dynamic = "force-dynamic"

export default async function Community() {
  // 只保留成功定位的来源, 让「已定位 N 个」计数与地图实际绘制的点数一致。
  const locations = (await getPublisherLocations()).filter(isLocated)

  return (
    <main className="m-2 flex flex-col gap-4 sm:m-4">
      <Card>
        <CardHeader>
          <CardTitle>发布者地图</CardTitle>
          <CardDescription>
            信息发布者的地理分布，点越大代表该来源的信息越多（已定位 {locations.length} 个来源）。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {locations.length ? (
            <PublisherMap locations={locations} />
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">暂无已定位的发布者。</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>社区发布者</CardTitle>
          <CardDescription>
            订阅社区里的发布者（用户），其发布的内容会出现在「我的空间 · 订阅」。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PeerPublishers />
        </CardContent>
      </Card>
    </main>
  )
}
