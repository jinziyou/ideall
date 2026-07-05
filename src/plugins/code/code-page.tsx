"use client"

import * as React from "react"
import {
  AlertTriangle,
  Bug,
  ClipboardCopy,
  Database,
  Download,
  FileJson,
  HardDrive,
  Info,
  RefreshCw,
  ShieldCheck,
  Upload,
} from "lucide-react"
import { toast } from "sonner"
import { downloadTextFile } from "@/lib/browser-download"
import { formatBytes, formatTimestamp } from "@/lib/format"
import { secureStoreStatus, type SecureStoreStatus } from "@/lib/secure-store"
import {
  agentSettingsSecuritySnapshot,
  hydrateAgentSettingsSecure,
} from "@/plugins/agent/lib/agent-settings"
import {
  agentSecretsSecuritySnapshot,
  hydrateAgentSecretsSecure,
} from "@/plugins/agent/lib/agent-secrets"
import { getMcpServers } from "@/plugins/agent/lib/agent-mcp-registry"
import {
  hydrateMcpOAuthSecureForServers,
  mcpOAuthSecuritySnapshot,
} from "@/plugins/agent/lib/agent-oauth"
import {
  pluginDataPortById,
  inspectPluginDataPorts,
  type PluginDataInspection,
} from "@/plugins/shared/plugin-data-registry"
import { pluginDataFilename } from "@/plugins/shared/plugin-data"
import {
  formatPluginImportResult,
  importPluginDataPackage,
  previewPluginDataImport,
  restorePluginDataBackup,
  type PluginDataImportBackup,
  type PluginDataImportPreview,
} from "@/plugins/shared/plugin-data-manager"
import {
  inspectLocalDataSchemas,
  repairLocalDataSchema,
  repairLocalDataSchemas,
  type LocalDataSchemaInspection,
} from "@/plugins/shared/local-data-schema"
import { Button } from "@/ui/button"
import { EmptyState } from "@/ui/empty-state"
import { readBrowserCodeSnapshot, type CodeSnapshot, type StorageBucket } from "./code-snapshot"

export default function CodePage() {
  const [snapshot, setSnapshot] = React.useState<CodeSnapshot | null>(null)
  const [pluginData, setPluginData] = React.useState<PluginDataInspection[]>([])
  const [schemaData, setSchemaData] = React.useState<LocalDataSchemaInspection[]>([])
  const [security, setSecurity] = React.useState<SecurityDiagnostics | null>(null)
  const [importPreview, setImportPreview] = React.useState<PluginDataImportPreview | null>(null)
  const [importBackup, setImportBackup] = React.useState<PluginDataImportBackup | null>(null)
  const [importRaw, setImportRaw] = React.useState<string | null>(null)
  const [pluginLoading, setPluginLoading] = React.useState(false)
  const [importing, setImporting] = React.useState(false)
  const [restoringBackup, setRestoringBackup] = React.useState(false)
  const [repairingSchema, setRepairingSchema] = React.useState<string | null>(null)
  const importInputRef = React.useRef<HTMLInputElement | null>(null)

  const refresh = React.useCallback(() => {
    setSnapshot(readBrowserCodeSnapshot())
    setPluginLoading(true)
    inspectPluginDataPorts()
      .then(setPluginData)
      .finally(() => setPluginLoading(false))
    readSecurityDiagnostics()
      .then(setSecurity)
      .catch(() => setSecurity(null))
    inspectLocalDataSchemas()
      .then(setSchemaData)
      .catch(() => setSchemaData([]))
  }, [])

  React.useEffect(() => {
    refresh()
  }, [refresh])

  const copySnapshot = async () => {
    if (!snapshot) return
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(createCodeBundle(snapshot, pluginData, schemaData, security), null, 2),
      )
      toast("已复制诊断信息")
    } catch {
      toast.error("复制失败")
    }
  }

  const downloadBundle = () => {
    if (!snapshot) return
    downloadTextFile(
      pluginDataFilename("ideall-code-bundle"),
      JSON.stringify(createCodeBundle(snapshot, pluginData, schemaData, security), null, 2),
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

  const selectImportFile = () => {
    if (importInputRef.current) importInputRef.current.value = ""
    importInputRef.current?.click()
  }

  const readImportFile = async (file: File) => {
    try {
      const raw = await file.text()
      setImportRaw(raw)
      setImportBackup(null)
      setImportPreview(await previewPluginDataImport(raw, file.name))
    } catch (e) {
      setImportRaw(null)
      setImportBackup(null)
      setImportPreview({
        ok: false,
        filename: file.name,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  const executePluginImport = async () => {
    if (!importRaw || !importPreview?.filename) return
    setImporting(true)
    try {
      const result = await importPluginDataPackage(importRaw, importPreview.filename)
      setImportBackup(result.backup)
      toast("插件数据已导入", {
        description: result.backup
          ? `${formatPluginImportResult(result.result)} / 已创建导入前备份`
          : formatPluginImportResult(result.result),
      })
      setImportRaw(null)
      setImportPreview(null)
      refresh()
    } catch (e) {
      toast.error("导入失败", { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setImporting(false)
    }
  }

  const restoreImportBackup = async () => {
    if (!importBackup) return
    setRestoringBackup(true)
    try {
      const result = await restorePluginDataBackup(importBackup)
      toast("已恢复导入前备份", { description: formatPluginImportResult(result.result) })
      setImportBackup(null)
      refresh()
    } catch (e) {
      toast.error("恢复失败", { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setRestoringBackup(false)
    }
  }

  const migrateSensitiveDataOnly = async () => {
    await Promise.all([
      hydrateAgentSettingsSecure(),
      hydrateAgentSecretsSecure(),
      hydrateMcpOAuthSecureForServers(getMcpServers().map((server) => server.id)),
    ])
  }

  const migrateSensitiveData = async () => {
    try {
      await migrateSensitiveDataOnly()
      toast("已迁移可识别的敏感配置")
      refresh()
    } catch (e) {
      toast.error("迁移失败", { description: e instanceof Error ? e.message : String(e) })
    }
  }

  const repairOneSchema = async (id: string) => {
    setRepairingSchema(id)
    try {
      await migrateSensitiveDataOnly()
      const result = await repairLocalDataSchema(id)
      if (result.ok) toast.success(result.detail)
      else toast.error(result.detail)
      refresh()
    } catch (e) {
      toast.error("修复失败", { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setRepairingSchema(null)
    }
  }

  const repairAllSchemas = async () => {
    const ids = schemaData
      .filter((entry) => entry.repairable && ["warning", "error"].includes(entry.status))
      .map((entry) => entry.id)
    if (!ids.length) return
    setRepairingSchema("*")
    try {
      await migrateSensitiveDataOnly()
      const results = await repairLocalDataSchemas(ids)
      const fixed = results.filter((result) => result.ok).length
      toast.success(`已修复 ${fixed}/${results.length} 项`)
      refresh()
    } catch (e) {
      toast.error("批量修复失败", { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setRepairingSchema(null)
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
      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          if (file) void readImportFile(file)
        }}
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

      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <SecurityPanel diagnostics={security} onMigrate={() => void migrateSensitiveData()} />
        <PluginDataPanel
          entries={pluginData}
          loading={pluginLoading}
          onExport={(pluginId) => void exportPluginData(pluginId)}
          onImportSelect={selectImportFile}
          importPreview={importPreview}
          importBackup={importBackup}
          importing={importing}
          restoringBackup={restoringBackup}
          onImportConfirm={() => void executePluginImport()}
          onImportCancel={() => {
            setImportRaw(null)
            setImportPreview(null)
          }}
          onBackupRestore={() => void restoreImportBackup()}
          onBackupDismiss={() => setImportBackup(null)}
        />
      </div>

      <SchemaPanel
        entries={schemaData}
        repairing={repairingSchema}
        onRepair={(id) => void repairOneSchema(id)}
        onRepairAll={() => void repairAllSchemas()}
      />

      <section className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
        <StoragePanel title="localStorage" bucket={snapshot.storage.localStorage} />
        <StoragePanel title="sessionStorage" bucket={snapshot.storage.sessionStorage} />
      </section>
    </div>
  )
}

type SecurityDiagnostics = {
  secureStore: SecureStoreStatus
  agentSettings: ReturnType<typeof agentSettingsSecuritySnapshot>
  agentSecrets: ReturnType<typeof agentSecretsSecuritySnapshot>
  mcpOAuth: ReturnType<typeof mcpOAuthSecuritySnapshot>
  issues: string[]
}

async function readSecurityDiagnostics(): Promise<SecurityDiagnostics> {
  const secureStore = await secureStoreStatus()
  const agentSettings = agentSettingsSecuritySnapshot()
  const agentSecrets = agentSecretsSecuritySnapshot()
  const mcpOAuth = mcpOAuthSecuritySnapshot()
  const issues = [
    !secureStore.native ? "当前环境未使用系统凭据后端" : "",
    agentSettings.localApiKeyPresent ? "全局 AI API Key 仍存在于 localStorage" : "",
    agentSecrets.localValueCount
      ? `${agentSecrets.localValueCount} 个 MCP 密钥值仍存在于 localStorage`
      : "",
    mcpOAuth.localTokenCount
      ? `${mcpOAuth.localTokenCount} 个 MCP OAuth token 仍存在于 localStorage`
      : "",
    mcpOAuth.localVerifierCount
      ? `${mcpOAuth.localVerifierCount} 个 MCP OAuth verifier 仍存在于 localStorage`
      : "",
  ].filter((issue): issue is string => Boolean(issue))
  return { secureStore, agentSettings, agentSecrets, mcpOAuth, issues }
}

function createCodeBundle(
  snapshot: CodeSnapshot,
  pluginData: PluginDataInspection[],
  schemaData: LocalDataSchemaInspection[],
  security?: SecurityDiagnostics | null,
) {
  return {
    kind: "ideall.code-bundle",
    version: 1,
    exportedAt: new Date().toISOString(),
    snapshot,
    pluginData,
    schemaData,
    security,
  }
}

function SecurityPanel({
  diagnostics,
  onMigrate,
}: {
  diagnostics: SecurityDiagnostics | null
  onMigrate: () => void
}) {
  const issueCount = diagnostics?.issues.length ?? 0
  return (
    <section className="rounded-lg border border-border/60 bg-card">
      <SectionTitle icon={ShieldCheck} title="安全存储" />
      <div className="space-y-3 p-4 text-sm">
        {!diagnostics ? (
          <div className="text-muted-foreground">正在读取安全存储状态</div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium">
                  {diagnostics.secureStore.native ? "系统凭据后端" : "本地存储降级"}
                </p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  {diagnostics.secureStore.backend}
                </p>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={onMigrate}>
                迁移敏感值
              </Button>
            </div>
            <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">AI Key</dt>
              <dd>{diagnostics.agentSettings.localApiKeyPresent ? "待迁移" : "未见明文本地值"}</dd>
              <dt className="text-muted-foreground">MCP 密钥</dt>
              <dd>
                {diagnostics.agentSecrets.localValueCount
                  ? `${diagnostics.agentSecrets.localValueCount} 个待迁移`
                  : `${diagnostics.agentSecrets.total} 个名称 / 未见明文本地值`}
              </dd>
              <dt className="text-muted-foreground">OAuth</dt>
              <dd>
                {diagnostics.mcpOAuth.localTokenCount || diagnostics.mcpOAuth.localVerifierCount
                  ? `${diagnostics.mcpOAuth.localTokenCount} token / ${diagnostics.mcpOAuth.localVerifierCount} verifier 待迁移`
                  : `${diagnostics.mcpOAuth.cachedTokenCount} 个 token 已载入安全缓存`}
              </dd>
            </dl>
            {issueCount > 0 ? (
              <div className="space-y-1 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700">
                {diagnostics.issues.map((issue) => (
                  <div key={issue} className="flex gap-1.5">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{issue}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2 text-xs text-emerald-700">
                未发现可自动迁移的明文敏感值
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}

function PluginDataPanel({
  entries,
  loading,
  onExport,
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
  onImportSelect: () => void
  importPreview: PluginDataImportPreview | null
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
  preview: PluginDataImportPreview
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

function SchemaPanel({
  entries,
  repairing,
  onRepair,
  onRepairAll,
}: {
  entries: LocalDataSchemaInspection[]
  repairing: string | null
  onRepair: (id: string) => void
  onRepairAll: () => void
}) {
  const issueCount = entries.filter((entry) =>
    ["warning", "error", "unknown"].includes(entry.status),
  ).length
  const repairableCount = entries.filter(
    (entry) => entry.repairable && ["warning", "error"].includes(entry.status),
  ).length
  return (
    <section className="rounded-lg border border-border/60 bg-card">
      <SectionTitle
        icon={Database}
        title={`数据 Schema · ${entries.length}`}
        actions={
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 px-2"
            disabled={!repairableCount || repairing !== null}
            onClick={onRepairAll}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${repairing === "*" ? "animate-spin" : ""}`} />
            修复全部
          </Button>
        }
      />
      <div className="overflow-auto p-2">
        {entries.length === 0 ? (
          <div className="px-2 py-8 text-center text-sm text-muted-foreground">
            正在读取 schema 状态
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 px-2 text-xs text-muted-foreground">
              <span>
                {issueCount ? `${issueCount} 项需要关注` : "全部已知 schema 正常或未创建"}
              </span>
              <span>·</span>
              <span>{entries.filter((entry) => entry.portable).length} 项支持插件数据迁移</span>
              <span>·</span>
              <span>{repairableCount} 项可自动修复</span>
            </div>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {entries.map((entry) => (
                <div key={entry.id} className="rounded-md border border-border/60 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium">{entry.label}</p>
                        <SchemaStatusBadge status={entry.status} />
                      </div>
                      <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                        {entry.key} · v{entry.currentVersion}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {entry.bytes === null ? "未知" : formatBytes(entry.bytes)}
                      </span>
                      {entry.repairable && ["warning", "error"].includes(entry.status) && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          disabled={repairing !== null}
                          onClick={() => onRepair(entry.id)}
                        >
                          {repairing === entry.id ? "修复中" : "修复"}
                        </Button>
                      )}
                    </div>
                  </div>
                  <dl className="mt-3 grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                    <dt className="text-muted-foreground">位置</dt>
                    <dd>{entry.storage}</dd>
                    <dt className="text-muted-foreground">归属</dt>
                    <dd>{entry.owner}</dd>
                    <dt className="text-muted-foreground">状态</dt>
                    <dd className="min-w-0 break-words">{entry.detail}</dd>
                    {(entry.sensitive || entry.portable) && (
                      <>
                        <dt className="text-muted-foreground">标记</dt>
                        <dd className="flex flex-wrap gap-1">
                          {entry.sensitive && (
                            <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-amber-700">
                              敏感
                            </span>
                          )}
                          {entry.portable && (
                            <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-700">
                              可迁移
                            </span>
                          )}
                        </dd>
                      </>
                    )}
                  </dl>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

function SchemaStatusBadge({ status }: { status: LocalDataSchemaInspection["status"] }) {
  const label =
    status === "ok"
      ? "正常"
      : status === "missing"
        ? "未创建"
        : status === "warning"
          ? "关注"
          : status === "error"
            ? "异常"
            : "未知"
  const className =
    status === "ok"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
      : status === "missing"
        ? "border-border bg-muted text-muted-foreground"
        : status === "warning"
          ? "border-amber-500/30 bg-amber-500/10 text-amber-700"
          : status === "error"
            ? "border-destructive/30 bg-destructive/10 text-destructive"
            : "border-border bg-muted text-muted-foreground"
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${className}`}>
      {label}
    </span>
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
  actions,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  actions?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="h-4 w-4 shrink-0 text-primary" />
        <h2 className="truncate text-sm font-medium">{title}</h2>
      </div>
      {actions}
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
          <h1 className="text-2xl font-semibold tracking-tight">Code</h1>
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
