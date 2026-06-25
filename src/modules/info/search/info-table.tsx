"use client"

import React from "react"
import { toast } from "sonner"
import { DataTable } from "../table"
import InfoToolbar from "./info-toolbar"
import { getSearchColumns } from "../columns"
import { fetchLatestInfo } from "../data"
import { Info } from "../model"

/** /info/search 搜索表格: 自身负责取数, 分页/过滤/工具栏交给统一的 DataTable。 */
export function InfoTable() {
  const [data, setData] = React.useState<Info[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [nonce, setNonce] = React.useState(0)
  // 列定义无状态, 仅创建一次; 否则每次 InfoTable 重渲染都新建 ColumnDef[] 引用、令 useReactTable 重建列模型。
  const columns = React.useMemo(() => getSearchColumns(), [])

  // 重试在事件处理器里 reset (非 effect, 不触发同步 setState lint), 再 bump nonce 重取初始列表。
  const reload = () => {
    setError(null)
    setLoading(true)
    setNonce((n) => n + 1)
  }

  React.useEffect(() => {
    let active = true
    async function fetchInfo() {
      const result = await fetchLatestInfo({})
      if (!active) return
      if (!result.ok) {
        setError(result.message)
        toast.error(result.message)
      } else {
        setData(result.data ?? [])
        setError(null)
      }
      setLoading(false)
    }
    fetchInfo()
    return () => {
      active = false
    }
  }, [nonce])

  return (
    <DataTable
      columns={columns}
      data={data}
      loading={loading}
      error={error}
      onRetry={reload}
      paginated
      toolbar={(table) => (
        // 工具栏成功搜索后更新数据并清除初载错误 (否则 error 态会盖住新结果)
        <InfoToolbar
          table={table}
          onResult={(items) => {
            setData(items)
            setError(null)
          }}
        />
      )}
    />
  )
}
