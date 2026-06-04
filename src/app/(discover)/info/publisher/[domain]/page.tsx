"use client"

import React, { use } from "react"
import { toast } from "sonner"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { fetchLatestInfo } from "../../action"
import { getInfoColumns } from "../../columns"
import { DataTable } from "../../table"
import { Info } from "../../model"
import { SubscribeButton } from "@/app/home/subscribe-button"

export default function InfoPublisherPage({ params }: { params: Promise<{ domain: string }> }) {
  const { domain: rawDomain } = use(params)
  const domain = decodeURIComponent(rawDomain)

  const [data, setData] = React.useState<Info[]>([])
  const [loading, setLoading] = React.useState(true)
  const columns = getInfoColumns()

  React.useEffect(() => {
    let active = true
    async function fetchInfo() {
      const result = await fetchLatestInfo({ publisher_domain: domain })
      if (!active) return
      if (!result.ok) {
        toast.error(result.message)
      } else {
        setData(result.data)
      }
      setLoading(false)
    }
    fetchInfo()
    return () => {
      active = false
    }
  }, [domain])

  return (
    <main className="m-2 sm:m-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base sm:text-lg">发布者: {domain}</CardTitle>
          <SubscribeButton sub={{ type: "publisher", key: domain, title: domain }} />
        </CardHeader>
        <CardContent>
          <DataTable columns={columns} data={data} loading={loading} />
        </CardContent>
      </Card>
    </main>
  )
}
