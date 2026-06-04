"use client"

import * as React from "react"
import {
  ColumnDef,
  ColumnFiltersState,
  SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type Table as TableInstance,
} from "@tanstack/react-table"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Loader2 } from "lucide-react"
import { DataTablePagination } from "@/components/data-table-pagination"

type ColumnMeta = { headerClassName?: string; cellClassName?: string }

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  /** true 时表体显示「加载中」占位行 (取数期间)。 */
  loading?: boolean
  /** 开启分页 + 排序 + 过滤模型, 并在底部渲染分页器 (用于 /info/search)。 */
  paginated?: boolean
  /** 表格上方的工具栏, 接收 table 实例以驱动过滤/分页 (仅 paginated 时有意义)。 */
  toolbar?: (table: TableInstance<TData>) => React.ReactNode
}

/**
 * 统一的信息表格 —— 既服务于简单只读列表 (实体页 / 发布者页 / 首页事件),
 * 也通过 `paginated` + `toolbar` 服务于带分页过滤的搜索页, 表头/表体渲染只此一份。
 */
export function DataTable<TData, TValue>({
  columns,
  data,
  loading = false,
  paginated = false,
  toolbar,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    ...(paginated
      ? {
          onSortingChange: setSorting,
          onColumnFiltersChange: setColumnFilters,
          getSortedRowModel: getSortedRowModel(),
          getFilteredRowModel: getFilteredRowModel(),
          getPaginationRowModel: getPaginationRowModel(),
          state: { sorting, columnFilters },
        }
      : {}),
  })

  const rows = table.getRowModel().rows

  return (
    <div>
      {toolbar?.(table)}
      <div className="w-full overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className={
                      (header.column.columnDef.meta as ColumnMeta | undefined)?.headerClassName
                    }
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  <span className="inline-flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    加载中…
                  </span>
                </TableCell>
              </TableRow>
            ) : rows?.length ? (
              rows.map((row) => (
                <TableRow key={row.id} data-state={row.getIsSelected() && "selected"}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={
                        (cell.column.columnDef.meta as ColumnMeta | undefined)?.cellClassName
                      }
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  暂无数据
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {paginated && <DataTablePagination table={table} />}
    </div>
  )
}
