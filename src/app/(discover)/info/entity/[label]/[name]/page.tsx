"use client"

import React, { use } from "react"
import { toast } from "sonner"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { fetchLatestInfo } from "../../../action"
import { getInfoColumns } from "../../../columns"
import { DataTable } from "../../../table"
import { Info } from "../../../model"
import { SubscribeButton } from "@/app/home/subscribe-button"

export default function EntityPage({
  params,
}: {
  params: Promise<{ label: string; name: string }>
}) {
  const { label, name: rawName } = use(params)
  const name = decodeURIComponent(rawName)

  const [data, setData] = React.useState<Info[]>([])
  const [loading, setLoading] = React.useState(true)
  const columns = getInfoColumns()

  React.useEffect(() => {
    let active = true
    async function fetchInfo() {
      const result = await fetchLatestInfo({ entity_label_name: [[label, name]] })
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
  }, [label, name])

  return (
    <main className="m-2 sm:m-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base sm:text-lg">
            实体: <span className="text-muted-foreground">{label}</span> · {name}
          </CardTitle>
          <SubscribeButton
            sub={{
              type: "entity",
              key: `${label}/${name}`,
              title: name,
              entityLabel: label,
              entityName: name,
            }}
          />
        </CardHeader>
        <CardContent>
          <DataTable columns={columns} data={data} loading={loading} />
        </CardContent>
      </Card>
    </main>
  )
}
