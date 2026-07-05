"use client"

import * as React from "react"
import { Bug, ClipboardCopy, Download, HardDrive, Info, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { downloadTextFile } from "@/lib/browser-download"
import { formatBytes, formatTimestamp } from "@/lib/format"
import {
  pluginDataPortById,
  inspectPluginDataPorts,
  type PluginDataInspection,
} from "@/plugins/shared/plugin-data-registry"
import { pluginDataFilename } from "@/plugins/shared/plugin-data"
import { Button } from "@/ui/button"
import { EmptyState } from "@/ui/empty-state"
import { readBrowserDebugSnapshot, type DebugSnapshot, type StorageBucket } from "./debug-snapshot"

export default function DebugPage() {
  const [snapshot, setSnapshot] = React.useState<DebugSnapshot | null>(null)
  const [pluginData, setPluginData] = React.useState<PluginDataInspection[]>([])
  const [pluginLoading, setPluginLoading] = React.useState(false)

  const refresh = React.useCallback(() => {
    setSnapshot(readBrowserDebugSnapshot())
    setPluginLoading(true)
    inspectPluginDataPorts()
      .then(setPluginData)
      .finally(() => setPluginLoading(false))
  }, [])

  React.useEffect(() => {
    refresh()
  }, [refresh])

  const copySnapshot = async () => {
    if (!snapshot) return
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(createDebugBundle(snapshot, pluginData), null, 2),
      )
      toast("已复制诊断信息")
    } catch {
      toast.error("复制失败")
    }
  }

  const downloadBundle = () => {
    if (!snapshot) return
    downloadTextFile(
      pluginDataFilename("ideall-debug-bundle"),
      JSON.stringify(createDebugBundle(snapshot, pluginData), null, 2),
    )
    toast("已导出诊断包")
  }

  const exportPluginData = async (pluginId: string) => {
    const port = pluginDataPortById(pluginId)
    if (!port) return
    try {
      downloadTextFile(pluginDataFilename(port.filenamePrefix), await port.exportJson())
      toast(`已导出${port.pluginLabel}数据`)
    } catch (e) {
      toast.error("导出失败", { description: e instanceof Error ? e.message : String(e) })
    }
  }

  if (!snapshot) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <PageHeader />
        <EmptyState icon={Bug} title="正在读取调试信息" bordered />
      </div>
    )
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-4">
      <PageHeader
        onRefresh={refresh}
        onCopy={() => void copySnapshot()}
        onDownload={downloadBundle}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section className="rounded-lg border border-border/60 bg-card">
          <SectionTitle icon={Info} title="运行环境" />
          <dl className="grid gap-2 p-4 text-sm">
            {Object.entries(snapshot.runtime).map(([key, value]) => (
              <div key={key} className="grid grid-cols-[120px_minmax(0,1fr)] gap-3">
                <dt className="text-muted-foreground">{key}</dt>
                <dd className="min-w-0 break-words font-mono text-xs">{String(value)}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="rounded-lg border border-border/60 bg-card">
          <SectionTitle icon={Bug} title="工作区快照" />
          {snapshot.workspace ? (
            <dl className="grid gap-2 p-4 text-sm">
              {Object.entries(snapshot.workspace).map(([key, value]) => (
                <div key={key} className="grid grid-cols-[120px_minmax(0,1fr)] gap-3">
                  <dt className="text-muted-foreground">{key}</dt>
                  <dd className="min-w-0 break-words font-mono text-xs">{String(value)}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <div className="p-4 text-sm text-muted-foreground">没有工作区持久化快照</div>
          )}
        </section>
      </div>

      <PluginDataPanel
        entries={pluginData}
        loading={pluginLoading}
        onExport={(pluginId) => void exportPluginData(pluginId)}
      />

      <section className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
        <StoragePanel title="localStorage" bucket={snapshot.storage.localStorage} />
        <StoragePanel title="sessionStorage" bucket={snapshot.storage.sessionStorage} />
      </section>
    </div>
  )
}

function createDebugBundle(snapshot: DebugSnapshot, pluginData: PluginDataInspection[]) {
  return {
    kind: "ideall.debug-bundle",
    version: 1,
    exportedAt: new Date().toISOString(),
    snapshot,
    pluginData,
  }
}

function PluginDataPanel({
  entries,
  loading,
  onExport,
}: {
  entries: PluginDataInspection[]
  loading: boolean
  onExport: (pluginId: string) => void
}) {
  return (
    <section className="rounded-lg border border-border/60 bg-card">
      <SectionTitle icon={HardDrive} title={`插件数据 · ${entries.length}`} />
      <div className="overflow-auto p-2">
        {loading && entries.length === 0 ? (
          <div className="px-2 py-8 text-center text-sm text-muted-foreground">
            正在读取插件数据
          </div>
        ) : entries.length === 0 ? (
          <div className="px-2 py-8 text-center text-sm text-muted-foreground">无插件数据端口</div>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {entries.map((entry) => (
              <div key={entry.pluginId} className="rounded-md border border-border/60 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">{entry.label}</p>
                      <StatusBadge status={entry.status} />
                    </div>
                    <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                      {entry.dataKind} v{entry.dataVersion}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {formatBytes(entry.bytes)}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1.5 px-2"
                      disabled={entry.status === "error"}
                      onClick={() => onExport(entry.pluginId)}
                    >
                      <Download className="h-3.5 w-3.5" />
                      导出
                    </Button>
                  </div>
                </div>
                <dl className="mt-3 grid grid-cols-[80px_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">内容</dt>
                  <dd className="min-w-0 break-words">{entry.detail}</dd>
                  <dt className="text-muted-foreground">条目</dt>
                  <dd className="tabular-nums">{entry.itemCount}</dd>
                  <dt className="text-muted-foreground">更新</dt>
                  <dd className="min-w-0 break-words">{formatTimestamp(entry.updatedAt)}</dd>
                  {entry.error && (
                    <>
                      <dt className="text-muted-foreground">错误</dt>
                      <dd className="min-w-0 break-words text-destructive">{entry.error}</dd>
                    </>
                  )}
                </dl>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function StatusBadge({ status }: { status: PluginDataInspection["status"] }) {
  const label = status === "ready" ? "可导出" : status === "empty" ? "空" : "异常"
  const className =
    status === "ready"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
      : status === "empty"
        ? "border-border bg-muted text-muted-foreground"
        : "border-destructive/30 bg-destructive/10 text-destructive"
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${className}`}>
      {label}
    </span>
  )
}

function StoragePanel({ title, bucket }: { title: string; bucket: StorageBucket }) {
  const entries = bucket.entries
  return (
    <section className="min-h-0 rounded-lg border border-border/60 bg-card">
      <SectionTitle icon={HardDrive} title={`${title} · ${entries.length}`} />
      <div className="max-h-[420px] overflow-auto p-2">
        {bucket.error ? (
          <div className="px-2 py-8 text-center text-sm text-destructive">{bucket.error}</div>
        ) : entries.length === 0 ? (
          <div className="px-2 py-8 text-center text-sm text-muted-foreground">无数据</div>
        ) : (
          <div className="flex flex-col gap-1">
            {entries.map((entry) => (
              <div key={entry.key} className="rounded-md px-2 py-2 hover:bg-muted/60">
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0 truncate font-mono text-xs">{entry.key}</p>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {formatBytes(entry.bytes)}
                  </span>
                </div>
                {entry.redacted && (
                  <div className="mt-1 text-[10px] font-medium text-amber-600">已脱敏</div>
                )}
                {entry.error && (
                  <div className="mt-1 text-[10px] font-medium text-destructive">读取失败</div>
                )}
                {entry.preview && (
                  <pre className="mt-1 overflow-hidden text-ellipsis whitespace-pre-wrap break-all text-[11px] leading-relaxed text-muted-foreground">
                    {entry.preview}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function SectionTitle({
  icon: Icon,
  title,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
}) {
  return (
    <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
      <Icon className="h-4 w-4 text-primary" />
      <h2 className="text-sm font-medium">{title}</h2>
    </div>
  )
}

function PageHeader({
  onRefresh,
  onCopy,
  onDownload,
}: {
  onRefresh?: () => void
  onCopy?: () => void
  onDownload?: () => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Debug</h1>
          <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
            本地运行态、工作区快照与浏览器存储诊断
          </p>
        </div>
        {onRefresh && onCopy && onDownload && (
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={onCopy}>
              <ClipboardCopy className="h-4 w-4" />
              复制
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={onDownload}
            >
              <Download className="h-4 w-4" />
              导出
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={onRefresh}
            >
              <RefreshCw className="h-4 w-4" />
              刷新
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
