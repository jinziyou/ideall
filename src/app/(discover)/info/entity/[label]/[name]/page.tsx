"use client"

import React, { use } from "react"
import { toast } from "sonner"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { fetchLatestInfo } from "../../../action"
import { getInfoColumns } from "../../../columns"
import { DataTable } from "../../../table"
import { Info } from "../../../model"
import { EntityEntryLinks } from "../../../cells"
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

  // 该实体的百科词条链接: 从已拉取的 Info 列表里取首个匹配 (label,name) 且带链接的实体。
  const entry = React.useMemo(() => {
    for (const info of data) {
      const match = info.labels?.find((e) => e.label === label && e.name === name)
      if (match && (match.baike_url || match.wikipedia_url)) return match
    }
    return undefined
  }, [data, label, name])

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
          <CardTitle className="flex flex-wrap items-center gap-2 text-base sm:text-lg">
            <span>
              实体: <span className="text-muted-foreground">{label}</span> · {name}
            </span>
            {entry && (
              <span className="flex items-center gap-1 text-xs font-normal">
                <EntityEntryLinks entity={entry} />
              </span>
            )}
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
