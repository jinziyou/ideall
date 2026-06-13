"use client"

import { Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { fetchLatestInfo } from "../data"
import { getInfoColumns } from "../columns"
import { DataTable } from "../table"
import { Info } from "../model"
import { SubscribeButton } from "@/components/feeders"
import { useApiResult } from "@/components/lib/use-api-result"

// 发布者页 (查询参数路由 /info/publisher?domain= , 兼容静态导出)。
function PublisherView() {
  const domain = useSearchParams().get("domain") ?? ""

  const columns = getInfoColumns()
  const { data, loading, error, reload } = useApiResult<Info[]>(
    () => fetchLatestInfo({ publisher_domain: domain }),
    [],
    [domain],
  )

  return (
    <main className="m-2 sm:m-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="min-w-0 break-all text-base sm:text-lg">发布者: {domain}</CardTitle>
          <SubscribeButton sub={{ type: "publisher", key: domain, title: domain }} />
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={data}
            loading={loading}
            error={error}
            onRetry={reload}
          />
        </CardContent>
      </Card>
    </main>
  )
}

export default function InfoPublisherPage() {
  return (
    <Suspense>
      <PublisherView />
    </Suspense>
  )
}
