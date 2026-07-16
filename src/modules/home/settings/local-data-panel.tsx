"use client"

import * as React from "react"
import {
  WORKSPACE_ARCHIVE_LIMITS,
  WORKSPACE_ARCHIVE_MIN_PASSPHRASE_LENGTH,
} from "@protocol/workspace-archive"
import {
  Archive,
  Database,
  Download,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Upload,
} from "lucide-react"
import { toast } from "sonner"
import { downloadTextFile } from "@/lib/browser-download"
import type { FileDocumentBinding } from "@/shared/use-file-document"
import { Button } from "@/ui/button"
import { Input } from "@/ui/input"
import { Panel } from "@/ui/panel"
import {
  SETTINGS_DATA_EXPORT_ACTION,
  SETTINGS_DATA_IMPORT_ACTION,
  SETTINGS_DATA_MIGRATE_SECURE_STORE_ACTION,
  SETTINGS_DATA_PERSIST_ACTION,
  SETTINGS_DATA_PREVIEW_IMPORT_ACTION,
  SETTINGS_DATA_SECURE_STORE_SELF_TEST_ACTION,
  decodeSettingsDataExportResult,
  decodeSettingsDataImportPreview,
  decodeSettingsDataImportResult,
  decodeSettingsDataPersistenceResult,
  decodeSettingsDataSecureStoreMigrationResult,
  decodeSettingsDataSecureStoreSelfTestResult,
  type DataSettingsDocument,
  type SettingsDataImportPreview,
} from "./settings-contract"

type SelectedArchive = Readonly<{ filename: string; content: string }>

export function LocalDataPanel({
  document,
}: {
  document: FileDocumentBinding<DataSettingsDocument>
}) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [selected, setSelected] = React.useState<SelectedArchive | null>(null)
  const [preview, setPreview] = React.useState<SettingsDataImportPreview | null>(null)
  const [reloadRequired, setReloadRequired] = React.useState(false)
  const [exportPassphrase, setExportPassphrase] = React.useState("")
  const [importPassphrase, setImportPassphrase] = React.useState("")

  const exportArchive = React.useCallback(async () => {
    if (
      exportPassphrase.length > 0 &&
      exportPassphrase.length < WORKSPACE_ARCHIVE_MIN_PASSPHRASE_LENGTH
    ) {
      toast.error(`加密口令至少需要 ${WORKSPACE_ARCHIVE_MIN_PASSPHRASE_LENGTH} 个字符`)
      return
    }
    try {
      const result = decodeSettingsDataExportResult(
        await document.invoke(
          SETTINGS_DATA_EXPORT_ACTION,
          exportPassphrase ? { passphrase: exportPassphrase } : undefined,
        ),
      )
      downloadTextFile(result.filename, result.content)
      setExportPassphrase("")
      toast.success(result.encrypted ? "加密工作区归档已导出" : "工作区归档已导出")
    } catch (error) {
      toast.error("导出失败", {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }, [document, exportPassphrase])

  const previewArchive = React.useCallback(
    async (archive: SelectedArchive, passphrase: string) => {
      const nextPreview = decodeSettingsDataImportPreview(
        await document.invoke(SETTINGS_DATA_PREVIEW_IMPORT_ACTION, {
          ...archive,
          ...(passphrase ? { passphrase } : {}),
        }),
      )
      setPreview(nextPreview)
      setReloadRequired(false)
      if (!nextPreview.ok) {
        toast.error("归档预检未通过", { description: nextPreview.error ?? undefined })
      }
    },
    [document],
  )

  const selectArchive = React.useCallback(
    async (file: File) => {
      try {
        if (file.size > WORKSPACE_ARCHIVE_LIMITS.maxEnvelopeBytes) {
          throw new Error(
            `归档文件过大（最大 ${Math.floor(WORKSPACE_ARCHIVE_LIMITS.maxEnvelopeBytes / 1024 / 1024)} MiB）`,
          )
        }
        const next = { filename: file.name, content: await file.text() }
        setImportPassphrase("")
        setSelected(next)
        await previewArchive(next, "")
      } catch (error) {
        setPreview(null)
        toast.error("无法读取归档", {
          description: error instanceof Error ? error.message : String(error),
        })
      } finally {
        if (inputRef.current) inputRef.current.value = ""
      }
    },
    [previewArchive],
  )

  const importArchive = React.useCallback(async () => {
    if (!selected || !preview?.ok) return
    try {
      const result = decodeSettingsDataImportResult(
        await document.invoke(SETTINGS_DATA_IMPORT_ACTION, {
          ...selected,
          ...(importPassphrase ? { passphrase: importPassphrase } : {}),
        }),
      )
      setReloadRequired(result.reloadRequired)
      toast.success(
        `已导入 ${result.imported.nodes} 个节点、${result.imported.blobs} 个文件和 ${result.imported.plugins} 组插件数据`,
      )
    } catch (error) {
      toast.error("导入失败，原工作区已尝试恢复", {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }, [document, importPassphrase, preview?.ok, selected])

  const requestPersistence = React.useCallback(async () => {
    try {
      const result = decodeSettingsDataPersistenceResult(
        await document.invoke(SETTINGS_DATA_PERSIST_ACTION),
      )
      if (!result.available) {
        toast.error("当前环境不支持持久存储请求")
      } else if (result.granted) {
        toast.success("已启用持久存储保护")
      } else {
        toast.error("未获得持久存储授权，系统仍可能在空间紧张时回收数据")
      }
    } catch (error) {
      toast.error("请求持久存储失败", {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }, [document])

  const selfTestSecureStore = React.useCallback(async () => {
    try {
      decodeSettingsDataSecureStoreSelfTestResult(
        await document.invoke(SETTINGS_DATA_SECURE_STORE_SELF_TEST_ACTION),
      )
      toast.success("系统凭据库写入、读回与清理自检通过")
    } catch (error) {
      toast.error("系统凭据库自检失败", {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }, [document])

  const migrateSecureStore = React.useCallback(async () => {
    try {
      const result = decodeSettingsDataSecureStoreMigrationResult(
        await document.invoke(SETTINGS_DATA_MIGRATE_SECURE_STORE_ACTION),
      )
      await document.refresh()
      if (!result.available) {
        toast.error("遗留凭据迁移仅可在桌面 App 中运行")
      } else if (result.failed > 0 || result.remaining > 0) {
        toast.error("部分遗留凭据未能迁移", {
          description: `已迁移 ${result.migrated} 项、清理 ${result.removedPlaintext} 个明文副本；失败 ${result.failed} 项，剩余 ${result.remaining} 项。`,
        })
      } else {
        toast.success(
          `遗留凭据迁移完成：迁移 ${result.migrated} 项，清理 ${result.removedPlaintext} 个明文副本`,
        )
      }
    } catch (error) {
      toast.error("遗留凭据迁移失败", {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }, [document])

  const secureStore = document.data?.secureStore
  const secureHealthy = secureStore?.backend === "system-keychain" && secureStore.native
  const fallbackCount = secureStore?.fallbackValueCount ?? 0
  const legacyCount = secureStore?.legacyValueCount ?? 0

  return (
    <Panel title="本地数据">
      <div className="space-y-5">
        <div className="flex items-start gap-3">
          <Archive className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">完整工作区归档</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              包含节点、文件 Blob、回收站、标签布局和插件数据；不包含登录令牌、同步码、API Key
              等本机密钥。导入会替换当前工作区。
            </p>
            <div className="mt-3 max-w-md space-y-1.5">
              <label htmlFor="workspace-export-passphrase" className="text-xs font-medium">
                导出加密口令（可选）
              </label>
              <Input
                id="workspace-export-passphrase"
                type="password"
                autoComplete="new-password"
                value={exportPassphrase}
                disabled={document.acting}
                placeholder={`留空导出明文；加密至少 ${WORKSPACE_ARCHIVE_MIN_PASSPHRASE_LENGTH} 个字符`}
                onChange={(event) => setExportPassphrase(event.target.value)}
              />
              <p className="text-xs leading-5 text-muted-foreground">
                口令不会保存且无法找回；跨设备归档建议加密后再传输。
              </p>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={document.acting}
                onClick={exportArchive}
              >
                {document.acting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                导出归档
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={document.acting}
                onClick={() => inputRef.current?.click()}
              >
                <Upload className="h-4 w-4" />
                选择归档
              </Button>
              <input
                ref={inputRef}
                className="hidden"
                type="file"
                accept="application/json,.json"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void selectArchive(file)
                }}
              />
            </div>
          </div>
        </div>

        {preview ? (
          <div
            className={`rounded-md border p-3 text-xs ${
              preview.ok ? "border-border bg-muted/30" : "border-destructive/40 bg-destructive/5"
            }`}
          >
            {selected && preview.encrypted ? (
              <div className="mb-3 max-w-md space-y-2">
                <label htmlFor="workspace-import-passphrase" className="font-medium">
                  加密归档口令
                </label>
                <Input
                  id="workspace-import-passphrase"
                  type="password"
                  autoComplete="current-password"
                  value={importPassphrase}
                  disabled={document.acting}
                  onChange={(event) => setImportPassphrase(event.target.value)}
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    document.acting ||
                    importPassphrase.length < WORKSPACE_ARCHIVE_MIN_PASSPHRASE_LENGTH
                  }
                  onClick={() => void previewArchive(selected, importPassphrase)}
                >
                  重新预检
                </Button>
              </div>
            ) : null}
            {preview.ok && preview.archive ? (
              <>
                <p className="font-medium">{preview.filename ?? "工作区归档"}</p>
                <p className="mt-1 leading-5 text-muted-foreground">
                  将替换为 {preview.archive.nodeCount} 个节点、{preview.archive.blobCount} 个文件、
                  {preview.archive.trashSnapshotCount} 个回收站快照、{preview.archive.pluginCount}
                  组插件数据和 {preview.archive.tabCount} 个标签页。
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={document.acting || reloadRequired}
                    onClick={() => void importArchive()}
                  >
                    {document.acting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    确认替换当前工作区
                  </Button>
                  {reloadRequired ? (
                    <Button size="sm" onClick={() => window.location.reload()}>
                      <RefreshCw className="h-4 w-4" />
                      重新加载并应用
                    </Button>
                  ) : null}
                </div>
              </>
            ) : (
              <p className="text-destructive">{preview.error ?? "归档格式无效"}</p>
            )}
          </div>
        ) : null}

        <div className="border-t pt-4">
          <div className="flex items-start gap-3">
            <Database
              className={`mt-0.5 h-5 w-5 shrink-0 ${
                document.data?.database.status === "healthy"
                  ? "text-emerald-600"
                  : "text-destructive"
              }`}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {document.data?.database.status === "healthy"
                  ? `本地数据库健康 · ${document.data.database.name} v${document.data.database.version}`
                  : "本地数据库不可用"}
              </p>
              {document.data?.database.counts ? (
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {document.data.database.counts.nodes} 个节点 /{" "}
                  {document.data.database.counts.blobs}个 Blob /{" "}
                  {document.data.database.counts.trashSnapshots} 个回收站快照 /{" "}
                  {document.data.database.counts.agentTasks} 条 Agent 任务记录
                </p>
              ) : null}
              {document.data?.database.error ? (
                <p className="mt-1 break-words text-xs text-destructive">
                  {document.data.database.error}
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {document.data?.storage.persisted === true
                    ? "存储已标记为持久"
                    : document.data?.storage.persistenceAvailable
                      ? "存储尚未获得持久保护"
                      : "当前环境未提供持久存储接口"}
                </span>
                {document.data?.storage.persistenceAvailable &&
                document.data.storage.persisted !== true ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={document.acting}
                    onClick={() => void requestPersistence()}
                  >
                    请求持久存储
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className="border-t pt-4">
          <div className="flex items-start gap-3">
            {secureHealthy ? (
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            ) : (
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {secureHealthy
                  ? "敏感凭据由系统凭据库保护"
                  : secureStore?.backend === "web-localStorage"
                    ? "浏览器开发形态使用本地 fallback"
                    : "系统凭据库当前不可用"}
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                桌面 App 在凭据库故障时不会把新密钥降级写入 localStorage。
                {fallbackCount + legacyCount > 0
                  ? ` 检测到 ${fallbackCount} 项旧 fallback 和 ${legacyCount} 项旧公开凭据，请先导出工作区并重新配置相关密钥。`
                  : " 未检测到遗留明文凭据。"}
              </p>
              {secureStore?.error ? (
                <p className="mt-1 break-words text-xs text-destructive">{secureStore.error}</p>
              ) : null}
              {secureStore && secureStore.backend !== "web-localStorage" ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={document.acting}
                    onClick={() => void selfTestSecureStore()}
                  >
                    {document.acting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    运行系统凭据库自检
                  </Button>
                  {fallbackCount + legacyCount > 0 ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={document.acting || !secureHealthy}
                      onClick={() => void migrateSecureStore()}
                    >
                      迁移遗留明文凭据
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </Panel>
  )
}
