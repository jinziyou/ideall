"use client"

import { use } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { fetchLatestInfo } from "../../action"
import { getInfoColumns } from "../../columns"
import { DataTable } from "../../table"
import { Info } from "../../model"
import { SubscribeButton } from "@/components/feeders"
import { useApiResult } from "@/lib/use-api-result"

export default function InfoPublisherPage({ params }: { params: Promise<{ domain: string }> }) {
  const { domain: rawDomain } = use(params)
  const domain = decodeURIComponent(rawDomain)

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
          <CardTitle className="text-base sm:text-lg">发布者: {domain}</CardTitle>
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
