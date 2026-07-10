"use client"

import * as React from "react"
import {
  ClipboardCopy,
  Database,
  FileDown,
  FileUp,
  Plus,
  Search,
  Table2,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { downloadTextFile } from "@/lib/browser-download"
import { pluginDataFilename } from "@/plugins/shared/plugin-data"
import { Button } from "@/ui/button"
import { EmptyState } from "@/ui/empty-state"
import { Input } from "@/ui/input"
import {
  addRow,
  createTable,
  deleteRow,
  deleteTable,
  exportDatabaseJson,
  importDatabaseJson,
  listRows,
  listTables,
  normalizeColumns,
  rowValuesForColumns,
  type DataRow,
  type DataTable,
} from "./database-store"

export default function DatabasePage({ initialTableId }: { initialTableId?: string } = {}) {
  const [tables, setTables] = React.useState<DataTable[]>([])
  const [activeId, setActiveId] = React.useState<string | null>(null)
  const [rows, setRows] = React.useState<DataRow[]>([])
  const [tableName, setTableName] = React.useState("")
  const [columnsInput, setColumnsInput] = React.useState("name, value")
  const [draft, setDraft] = React.useState<Record<string, string>>({})
  const [filter, setFilter] = React.useState("")
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const importInputRef = React.useRef<HTMLInputElement | null>(null)

  const activeTable = React.useMemo(
    () => tables.find((table) => table.id === activeId) ?? null,
    [activeId, tables],
  )

  React.useEffect(() => {
    let alive = true
    listTables()
      .then((next) => {
        if (!alive) return
        setTables(next)
        setActiveId((current) => current ?? initialTableId ?? next[0]?.id ?? null)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [initialTableId])

  React.useEffect(() => {
    if (!activeId) {
      setRows([])
      return
    }
    let alive = true
    listRows(activeId).then((next) => {
      if (alive) setRows(next)
    })
    return () => {
      alive = false
    }
  }, [activeId])

  React.useEffect(() => {
    if (!activeTable) {
      setDraft({})
      return
    }
    setDraft(Object.fromEntries(activeTable.columns.map((column) => [column, ""])))
  }, [activeTable])

  const reloadTables = async (selectId?: string | null) => {
    const next = await listTables()
    setTables(next)
    if (selectId !== undefined) {
      setActiveId(selectId)
      if (selectId !== activeId) setRows([])
    } else if (activeId && !next.some((table) => table.id === activeId)) {
      setActiveId(next[0]?.id ?? null)
    } else if (!activeId) {
      setActiveId(next[0]?.id ?? null)
    }
  }

  const reloadRows = async () => {
    if (!activeId) return
    setRows(await listRows(activeId))
  }

  const handleCreateTable = async () => {
    if (busy) return
    setBusy(true)
    try {
      const table = await createTable(tableName, normalizeColumns(columnsInput))
      setTableName("")
      await reloadTables(table.id)
      toast("已创建表")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "建表失败")
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteTable = async () => {
    if (!activeTable || busy) return
    setBusy(true)
    try {
      await deleteTable(activeTable.id)
      setRows([])
      await reloadTables(null)
      toast("已删除表")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除表失败")
    } finally {
      setBusy(false)
    }
  }

  const handleAddRow = async () => {
    if (!activeTable || busy) return
    setBusy(true)
    try {
      const values = rowValuesForColumns(activeTable.columns, draft)
      await addRow(activeTable.id, values)
      setDraft(Object.fromEntries(activeTable.columns.map((column) => [column, ""])))
      await reloadRows()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "写入失败")
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteRow = async (id: string) => {
    await deleteRow(id)
    await reloadRows()
  }

  const handleExport = async () => {
    if (!activeTable) return
    const payload = JSON.stringify({ table: activeTable, rows }, null, 2)
    try {
      await navigator.clipboard.writeText(payload)
      toast("已复制 JSON")
    } catch {
      toast.error("复制失败")
    }
  }

  const handleExportAll = async () => {
    try {
      downloadTextFile(pluginDataFilename("ideall-database"), await exportDatabaseJson())
      toast("已导出数据库 JSON")
    } catch (e) {
      toast.error("导出失败", { description: e instanceof Error ? e.message : String(e) })
    }
  }

  const handleImportJson = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file || busy) return
    setBusy(true)
    try {
      const result = await importDatabaseJson(await file.text())
      setRows([])
      await reloadTables()
      toast(`已导入 ${result.tables} 张表、${result.rows} 行`)
    } catch (e) {
      toast.error("导入失败", { description: e instanceof Error ? e.message : String(e) })
    } finally {
      if (importInputRef.current) importInputRef.current.value = ""
      setBusy(false)
    }
  }

  const filteredRows = React.useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((row) => Object.values(row.values).join("\n").toLowerCase().includes(q))
  }, [filter, rows])

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-4">
      <PageHeader
        busy={busy}
        onImport={() => importInputRef.current?.click()}
        onExport={() => void handleExportAll()}
      />
      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => void handleImportJson(e.target.files)}
      />

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col gap-3 rounded-lg border border-border/60 bg-card p-3">
          <div className="space-y-2 rounded-md border border-border/60 p-3">
            <h2 className="text-sm font-medium">新建表</h2>
            <Input
              value={tableName}
              onChange={(e) => setTableName(e.target.value)}
              placeholder="table name"
              className="h-9"
            />
            <Input
              value={columnsInput}
              onChange={(e) => setColumnsInput(e.target.value)}
              placeholder="columns"
              className="h-9"
            />
            <Button
              type="button"
              size="sm"
              className="w-full gap-1.5"
              disabled={busy || !tableName.trim()}
              onClick={() => void handleCreateTable()}
            >
              <Plus className="h-4 w-4" />
              创建
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {loading ? (
              <div className="h-32 animate-pulse rounded bg-muted/50" />
            ) : tables.length === 0 ? (
              <div className="rounded-md border border-dashed border-border/70 p-3 text-sm text-muted-foreground">
                暂无表
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {tables.map((table) => (
                  <button
                    key={table.id}
                    type="button"
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors",
                      table.id === activeId ? "bg-primary/10 text-primary" : "hover:bg-muted/60",
                    )}
                    onClick={() => setActiveId(table.id)}
                  >
                    <Table2 className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{table.name}</span>
                    <span className="text-xs text-muted-foreground">{table.columns.length}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>

        <main className="min-h-0 overflow-auto rounded-lg border border-border/60 bg-card p-4">
          {!activeTable ? (
            <div className="flex h-full min-h-[360px] items-center justify-center">
              <EmptyState icon={Database} title="创建或选择一张表" />
            </div>
          ) : (
            <div className="flex min-h-full flex-col gap-4">
              <section className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Database className="h-4 w-4 text-primary" />
                    <h2 className="truncate text-base font-semibold">{activeTable.name}</h2>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {activeTable.columns.map((column) => (
                      <span
                        key={column}
                        className="rounded-md bg-secondary px-2 py-1 text-xs text-secondary-foreground"
                      >
                        {column}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => void handleExport()}
                  >
                    <ClipboardCopy className="h-4 w-4" />
                    JSON
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1.5 text-destructive hover:text-destructive"
                    disabled={busy}
                    onClick={() => void handleDeleteTable()}
                  >
                    <Trash2 className="h-4 w-4" />
                    删除表
                  </Button>
                </div>
              </section>

              <section className="rounded-md border border-border/60 p-3">
                <h3 className="mb-3 text-sm font-medium">新增行</h3>
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {activeTable.columns.map((column) => (
                    <label key={column} className="min-w-0 space-y-1 text-xs text-muted-foreground">
                      <span>{column}</span>
                      <Input
                        value={draft[column] ?? ""}
                        onChange={(e) => setDraft((d) => ({ ...d, [column]: e.target.value }))}
                        className="h-9 text-sm"
                      />
                    </label>
                  ))}
                </div>
                <div className="mt-3 flex justify-end">
                  <Button
                    type="button"
                    size="sm"
                    className="gap-1.5"
                    disabled={busy}
                    onClick={() => void handleAddRow()}
                  >
                    <Plus className="h-4 w-4" />
                    写入
                  </Button>
                </div>
              </section>

              <section className="flex min-h-0 flex-1 flex-col rounded-md border border-border/60">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 p-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Table2 className="h-4 w-4" />
                    {filteredRows.length} / {rows.length}
                  </div>
                  <div className="relative w-full sm:w-64">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      placeholder="filter"
                      className="h-9 pl-8"
                    />
                  </div>
                </div>

                <div className="min-h-0 overflow-auto">
                  {filteredRows.length === 0 ? (
                    <div className="px-3 py-12 text-center text-sm text-muted-foreground">
                      暂无数据
                    </div>
                  ) : (
                    <table className="w-full min-w-[640px] text-left text-sm">
                      <thead className="sticky top-0 bg-card">
                        <tr className="border-b border-border/60">
                          {activeTable.columns.map((column) => (
                            <th key={column} className="px-3 py-2 font-medium">
                              {column}
                            </th>
                          ))}
                          <th className="w-12 px-3 py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {filteredRows.map((row) => (
                          <tr key={row.id} className="border-b border-border/40 last:border-0">
                            {activeTable.columns.map((column) => (
                              <td key={column} className="max-w-[260px] truncate px-3 py-2">
                                {row.values[column]}
                              </td>
                            ))}
                            <td className="px-3 py-2 text-right">
                              <button
                                type="button"
                                aria-label="删除行"
                                onClick={() => void handleDeleteRow(row.id)}
                              >
                                <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </section>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

function PageHeader({
  busy,
  onImport,
  onExport,
}: {
  busy: boolean
  onImport: () => void
  onExport: () => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">数据库</h1>
          <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
            本地表、行记录与 JSON 导出
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={busy}
            onClick={onImport}
          >
            <FileUp className="h-4 w-4" />
            导入 JSON
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={busy}
            onClick={onExport}
          >
            <FileDown className="h-4 w-4" />
            导出全部
          </Button>
        </div>
      </div>
    </div>
  )
}
