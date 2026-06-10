"use client"

import * as React from "react"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { DataTable } from "./table"
import { getEventColumns, getInfoColumns, getPublisherGroupColumns } from "./columns"
import { fetchInfoEvents } from "./action"
import { InfoEvent } from "./model"
import { rankEventsByTrend, flattenEvents, groupByPublisher } from "./derive"
import { useApiResult } from "@/components/lib/use-api-result"

const HOUR_MS = 60 * 60 * 1000

/** 时间段选项: sentinel "all" 表示不限 (不传 timestamp_from_to)。 */
const RANGE_OPTIONS: { value: string; text: string; ms?: number }[] = [
  { value: "all", text: "全部" },
  { value: "24h", text: "24 小时", ms: 24 * HOUR_MS },
  { value: "3d", text: "3 天", ms: 3 * 24 * HOUR_MS },
  { value: "7d", text: "7 天", ms: 7 * 24 * HOUR_MS },
  { value: "30d", text: "30 天", ms: 30 * 24 * HOUR_MS },
]

/** /info 首页的三种视图: 热点 (默认) / 发布者 / 最新。 */
type ViewMode = "hot" | "publisher" | "latest"

/**
 * /info 首页信息列表, 三种可切换视图 (本地优先: 数据在客户端按需拉取):
 *   - 热点 (默认): 事件簇 (共享实体聚类) 按时间趋势加权密度倒序 —— 密集且新近的簇排前;
 *   - 发布者: 按发布者分组, 有最新更新的发布者排前;
 *   - 最新: 摊平的单条信息列表, 按收录时间倒序。
 * 三者共用一次 /info/events 取数 (事件聚类无损覆盖同页全部信息), 切换视图零额外请求;
 * 时间段筛选对三种视图同样生效 (换算 timestamp_from_to 重新拉取)。
 */
export default function InfoList() {
  const [mode, setMode] = React.useState<ViewMode>("hot")
  const [range, setRange] = React.useState("all")

  const { data, loading, error, reload } = useApiResult<InfoEvent[]>(
    () => {
      // 选了时间段则换算成 [now-X, now] 毫秒闭区间重新拉取; 「全部」不传 (后端不限时间)。
      const ms = RANGE_OPTIONS.find((o) => o.value === range)?.ms
      return fetchInfoEvents(ms ? { timestamp_from_to: [Date.now() - ms, Date.now()] } : {})
    },
    [],
    [range],
  )

  const hotEvents = React.useMemo(() => rankEventsByTrend(data), [data])
  const latestInfos = React.useMemo(() => flattenEvents(data), [data])
  const publisherGroups = React.useMemo(() => groupByPublisher(latestInfos), [latestInfos])

  const tableProps = { loading, error, onRetry: reload }

  return (
    <div className="flex flex-col gap-3 px-2 pt-4 sm:px-4 sm:pt-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <Tabs
            value={mode}
            onValueChange={(v) => setMode(v as ViewMode)}
            className="w-full sm:w-auto"
          >
            <TabsList className="w-full sm:w-auto">
              <TabsTrigger value="hot" className="flex-1 sm:flex-none">
                热点
              </TabsTrigger>
              <TabsTrigger value="publisher" className="flex-1 sm:flex-none">
                发布者
              </TabsTrigger>
              <TabsTrigger value="latest" className="flex-1 sm:flex-none">
                最新
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Select value={range} onValueChange={setRange}>
            <SelectTrigger className="h-9 w-full sm:w-[120px]" aria-label="时间段">
              <SelectValue placeholder="时间段" />
            </SelectTrigger>
            <SelectContent>
              {RANGE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.text}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" onClick={() => window.open(`/info/search`, "_blank")}>
          查看全部
        </Button>
      </div>

      {mode === "hot" && (
        <DataTable columns={getEventColumns()} data={hotEvents} {...tableProps} />
      )}
      {mode === "publisher" && (
        <>
          <p className="text-xs text-muted-foreground">
            条数与排序仅基于当前时间段内的信息，进入发布者页可查看其全部信息。
          </p>
          <DataTable columns={getPublisherGroupColumns()} data={publisherGroups} {...tableProps} />
        </>
      )}
      {mode === "latest" && (
        <DataTable columns={getInfoColumns()} data={latestInfos} {...tableProps} />
      )}
    </div>
  )
}
