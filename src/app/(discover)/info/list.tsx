"use client"

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { DataTable } from "./table"
import { getEventColumns } from "./columns"
import { fetchInfoEvents } from "./action"
import { InfoEvent } from "./model"
import { useApiResult } from "@/lib/use-api-result"

/** /info 首页的事件列表 (按同一事件聚类)。本地优先: 数据在客户端按需拉取。 */
export default function InfoList() {
  const { data, loading } = useApiResult<InfoEvent[]>(() => fetchInfoEvents({}), [], [])

  return (
    <div className="flex flex-col gap-3 px-2 pt-4 sm:px-4 sm:pt-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Tabs defaultValue="latest" className="w-full sm:w-auto">
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="latest" className="flex-1 sm:flex-none">
              最新
            </TabsTrigger>
            {/* TODO: 「热度」排序未实现 —— 需后端按来源数/热度返回事件后再启用, 暂禁用以免误导。 */}
            <TabsTrigger value="trending" className="flex-1 sm:flex-none" disabled>
              热度
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Button variant="outline" onClick={() => window.open(`/info/search`, "_blank")}>
          查看全部
        </Button>
      </div>

      <DataTable columns={getEventColumns()} data={data} loading={loading} />
    </div>
  )
}
