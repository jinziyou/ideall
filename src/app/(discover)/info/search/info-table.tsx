"use client"

import React from "react"
import { toast } from "sonner"
import { DataTable } from "../table"
import InfoToolbar from "./info-toolbar"
import { getSearchColumns } from "../columns"
import { fetchLatestInfo } from "../action"
import { Info } from "../model"

/** /info/search 搜索表格: 自身负责取数, 分页/过滤/工具栏交给统一的 DataTable。 */
export function InfoTable() {
  const [data, setData] = React.useState<Info[]>([])
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let active = true
    async function fetchInfo() {
      const result = await fetchLatestInfo({})
      if (!active) return
      if (!result.ok) {
        toast.error(result.message)
      } else {
        setData(result.data ?? [])
      }
      setLoading(false)
    }
    fetchInfo()
    return () => {
      active = false
    }
  }, [])

  return (
    <DataTable
      columns={getSearchColumns()}
      data={data}
      loading={loading}
      paginated
      toolbar={(table) => <InfoToolbar table={table} onResult={setData} />}
    />
  )
}
