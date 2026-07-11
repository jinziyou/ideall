"use client"

import { Download, FileJson, HardDrive, RefreshCw, Upload } from "lucide-react"
import { formatBytes, formatTimestamp } from "@/lib/format"
import type { PluginDataInspection } from "@/plugins/shared/plugin-data-registry"
import type {
  PluginDataImportBackup,
  PluginDataImportPreview,
} from "@/plugins/shared/plugin-data-manager"
import type { WorkspaceArchiveImportPreview } from "@/plugins/shared/workspace-archive"
import { Button } from "@/ui/button"
import type { CodeDataImportPreview } from "./code-data-transfer"
import { SectionTitle } from "./code-page-chrome"

export function PluginDataPanel({
  entries,
  loading,
  onExport,
  onExportAll,
  onImportSelect,
  importPreview,
  importBackup,
  importing,
  restoringBackup,
  onImportConfirm,
  onImportCancel,
  onBackupRestore,
  onBackupDismiss,
}: {
  entries: PluginDataInspection[]
  loading: boolean
  onExport: (pluginId: string) => void
  onExportAll: () => void
  onImportSelect: () => void
  importPreview: CodeDataImportPreview | null
  importBackup: PluginDataImportBackup | null
  importing: boolean
  restoringBackup: boolean
  onImportConfirm: () => void
  onImportCancel: () => void
  onBackupRestore: () => void
  onBackupDismiss: () => void
}) {
  return (
    <section className="rounded-lg border border-border/60 bg-card">
      <SectionTitle
        icon={HardDrive}
        title={`插件数据 · ${entries.length}`}
        actions={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 px-2"
              disabled={loading || entries.length === 0}
              onClick={onExportAll}
            >
              <Download className="h-3.5 w-3.5" />
              导出全部
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 px-2"
              onClick={onImportSelect}
            >
              <Upload className="h-3.5 w-3.5" />
              导入
            </Button>
          </div>
        }
      />
      <div className="space-y-2 overflow-auto p-2">
        {importPreview && (
          <ImportPreviewCard
            preview={importPreview}
            importing={importing}
            onConfirm={onImportConfirm}
            onCancel={onImportCancel}
          />
        )}
        {importBackup && (
          <ImportBackupCard
            backup={importBackup}
            restoring={restoringBackup}
            onRestore={onBackupRestore}
            onDismiss={onBackupDismiss}
          />
        )}
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

function ImportPreviewCard({
  preview,
  importing,
  onConfirm,
  onCancel,
}: {
  preview: CodeDataImportPreview
  importing: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const canImport = preview.ok && preview.target
  return (
    <div
      className={`rounded-md border p-3 ${
        canImport ? "border-primary/30 bg-primary/5" : "border-destructive/30 bg-destructive/10"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <FileJson className="h-4 w-4 text-primary" />
            <p className="truncate text-sm font-medium">{preview.filename ?? "插件数据 JSON"}</p>
          </div>
          {preview.package && (
            <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
              {preview.package.dataKind} v{preview.package.dataVersion}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={onCancel}>
            取消
          </Button>
          <Button type="button" size="sm" disabled={!canImport || importing} onClick={onConfirm}>
            {importing ? "导入中" : "执行导入"}
          </Button>
        </div>
      </div>
      {canImport ? (
        <dl className="mt-3 grid grid-cols-[80px_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">插件</dt>
          <dd>{preview.target!.pluginLabel}</dd>
          <dt className="text-muted-foreground">策略</dt>
          <dd>{importModeLabel(preview.target!.importMode)}</dd>
          <dt className="text-muted-foreground">说明</dt>
          <dd>{preview.target!.importDescription}</dd>
          {preview.workspace && (
            <>
              <dt className="text-muted-foreground">范围</dt>
              <dd>
                {preview.workspace.pluginCount} 个插件 ·{" "}
                {preview.workspace.plugins.map((plugin) => plugin.pluginLabel).join(" / ")}
              </dd>
            </>
          )}
          {isArchivePreview(preview) && preview.archive && (
            <>
              <dt className="text-muted-foreground">归档</dt>
              <dd>
                {preview.archive.nodeCount} 个节点 · {preview.archive.blobCount} 个 Blob ·{" "}
                {preview.archive.trashSnapshotCount} 个回收站快照 · {preview.archive.pluginCount}{" "}
                个插件 · {preview.archive.tabCount} 个标签
              </dd>
            </>
          )}
          {preview.current && (
            <>
              <dt className="text-muted-foreground">当前</dt>
              <dd>{preview.current.detail}</dd>
            </>
          )}
        </dl>
      ) : (
        <div className="mt-3 text-xs text-destructive">{preview.error ?? "无法导入"}</div>
      )}
    </div>
  )
}

function isArchivePreview(
  preview: CodeDataImportPreview,
): preview is WorkspaceArchiveImportPreview {
  return "archive" in preview
}

function ImportBackupCard({
  backup,
  restoring,
  onRestore,
  onDismiss,
}: {
  backup: PluginDataImportBackup
  restoring: boolean
  onRestore: () => void
  onDismiss: () => void
}) {
  return (
    <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-emerald-700" />
            <p className="truncate text-sm font-medium">导入前备份已创建</p>
          </div>
          <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
            {backup.dataKind} v{backup.dataVersion}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={onDismiss}>
            关闭
          </Button>
          <Button type="button" size="sm" disabled={restoring} onClick={onRestore}>
            {restoring ? "恢复中" : "恢复导入前备份"}
          </Button>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-[80px_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">插件</dt>
        <dd>{backup.pluginLabel}</dd>
        <dt className="text-muted-foreground">大小</dt>
        <dd>{formatBytes(backup.bytes)}</dd>
        <dt className="text-muted-foreground">创建</dt>
        <dd>{formatTimestamp(Date.parse(backup.createdAt))}</dd>
      </dl>
    </div>
  )
}

function importModeLabel(mode: NonNullable<PluginDataImportPreview["target"]>["importMode"]) {
  return mode === "replace" ? "覆盖" : mode === "merge" ? "合并" : "只校验"
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
