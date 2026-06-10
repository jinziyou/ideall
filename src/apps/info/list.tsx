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
import { getEventColumns } from "./columns"
import { fetchInfoEvents } from "./action"
import { InfoEvent } from "./model"
import { useApiResult } from "@/lib/use-api-result"

const HOUR_MS = 60 * 60 * 1000

/** 时间段选项: sentinel "all" 表示不限 (不传 timestamp_from_to)。 */
const RANGE_OPTIONS: { value: string; text: string; ms?: number }[] = [
  { value: "all", text: "全部" },
  { value: "24h", text: "24 小时", ms: 24 * HOUR_MS },
  { value: "3d", text: "3 天", ms: 3 * 24 * HOUR_MS },
  { value: "7d", text: "7 天", ms: 7 * 24 * HOUR_MS },
  { value: "30d", text: "30 天", ms: 30 * 24 * HOUR_MS },
]

/** /info 首页的事件列表 (按同一事件聚类)。本地优先: 数据在客户端按需拉取。 */
export default function InfoList() {
  const [tab, setTab] = React.useState("latest")
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

  // 「热度」在客户端排序即可: 后端按时间返回, source_count (来源数) 已随事件给出,
  // 同分按代表稿采集时间倒序保证次序稳定。「最新」直接用后端顺序。
  const sorted = React.useMemo(() => {
    if (tab !== "hot") return data
    return [...data].sort(
      (a, b) => b.source_count - a.source_count || b.lead.collect_time - a.lead.collect_time,
    )
  }, [data, tab])

  return (
    <div className="flex flex-col gap-3 px-2 pt-4 sm:px-4 sm:pt-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <Tabs value={tab} onValueChange={setTab} className="w-full sm:w-auto">
            <TabsList className="w-full sm:w-auto">
              <TabsTrigger value="latest" className="flex-1 sm:flex-none">
                最新
              </TabsTrigger>
              <TabsTrigger value="hot" className="flex-1 sm:flex-none">
                热度
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

      <DataTable
        columns={getEventColumns()}
        data={sorted}
        loading={loading}
        error={error}
        onRetry={reload}
      />
    </div>
  )
}
