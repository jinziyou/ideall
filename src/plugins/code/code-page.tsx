"use client"

import * as React from "react"
import { Bug } from "lucide-react"
import { toast } from "sonner"
import { downloadTextFile } from "@/lib/browser-download"
import {
  inspectPluginDataPorts,
  pluginDataPortById,
  type PluginDataInspection,
} from "@/plugins/shared/plugin-data-registry"
import { pluginDataFilename } from "@/plugins/shared/plugin-data"
import {
  exportWorkspaceBackupJson,
  formatPluginImportResult,
  type PluginDataImportBackup,
} from "@/plugins/shared/plugin-data-manager"
import { exportWorkspaceArchiveJson } from "@/plugins/shared/workspace-archive"
import {
  inspectLocalDataSchemas,
  repairLocalDataSchema,
  repairLocalDataSchemas,
  type LocalDataSchemaInspection,
} from "@/plugins/shared/local-data-schema"
import { EmptyState } from "@/ui/empty-state"
import { createCodeBundle } from "./code-bundle"
import {
  importCodeData,
  previewCodeDataImport,
  restoreCodeDataBackup,
  type CodeDataImportPreview,
} from "./code-data-transfer"
import { CodePageHeader } from "./code-page-chrome"
import { PluginDataPanel } from "./plugin-data-panel"
import { RuntimeOverview, StorageOverview } from "./runtime-storage-panels"
import { SchemaPanel } from "./schema-panel"
import { SecurityPanel } from "./security-panel"
import {
  migrateSensitiveDataToSecureStore,
  readSecurityDiagnostics,
  type SecurityDiagnostics,
} from "./security-diagnostics"
import { readBrowserCodeSnapshot, type CodeSnapshot } from "./code-snapshot"

export default function CodePage() {
  const [snapshot, setSnapshot] = React.useState<CodeSnapshot | null>(null)
  const [pluginData, setPluginData] = React.useState<PluginDataInspection[]>([])
  const [schemaData, setSchemaData] = React.useState<LocalDataSchemaInspection[]>([])
  const [security, setSecurity] = React.useState<SecurityDiagnostics | null>(null)
  const [importPreview, setImportPreview] = React.useState<CodeDataImportPreview | null>(null)
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
    } catch (error) {
      toast.error("导出失败", {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const exportWorkspaceBackup = async () => {
    try {
      downloadTextFile(
        pluginDataFilename("ideall-workspace-backup"),
        await exportWorkspaceBackupJson(),
      )
      toast("已导出全部插件数据")
    } catch (error) {
      toast.error("导出失败", {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const exportWorkspaceArchive = async () => {
    try {
      downloadTextFile(
        pluginDataFilename("ideall-workspace-archive"),
        await exportWorkspaceArchiveJson(),
      )
      toast("已导出完整工作区归档")
    } catch (error) {
      toast.error("归档失败", {
        description: error instanceof Error ? error.message : String(error),
      })
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
      setImportPreview(await previewCodeDataImport(raw, file.name))
    } catch (error) {
      setImportRaw(null)
      setImportBackup(null)
      setImportPreview({
        ok: false,
        filename: file.name,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const executePluginImport = async () => {
    if (!importRaw || !importPreview?.filename) return
    setImporting(true)
    try {
      const execution = await importCodeData(importRaw, importPreview.filename)
      setImportBackup(execution.backup)
      toast(execution.archive ? "工作区归档已导入" : "插件数据已导入", {
        description: execution.backup
          ? `${formatPluginImportResult(execution.result)} / 已创建导入前备份`
          : formatPluginImportResult(execution.result),
      })
      setImportRaw(null)
      setImportPreview(null)
      refresh()
    } catch (error) {
      toast.error("导入失败", {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setImporting(false)
    }
  }

  const restoreImportBackup = async () => {
    if (!importBackup) return
    setRestoringBackup(true)
    try {
      const execution = await restoreCodeDataBackup(importBackup)
      toast(execution.archive ? "已恢复工作区归档备份" : "已恢复导入前备份", {
        description: formatPluginImportResult(execution.result),
      })
      setImportBackup(null)
      refresh()
    } catch (error) {
      toast.error("恢复失败", {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setRestoringBackup(false)
    }
  }

  const migrateSensitiveData = async () => {
    try {
      await migrateSensitiveDataToSecureStore()
      toast("已处理可识别的敏感配置")
      refresh()
    } catch (error) {
      toast.error("处理失败", {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const repairOneSchema = async (id: string) => {
    setRepairingSchema(id)
    try {
      await migrateSensitiveDataToSecureStore()
      const result = await repairLocalDataSchema(id)
      if (result.ok) toast.success(result.detail)
      else toast.error(result.detail)
      refresh()
    } catch (error) {
      toast.error("修复失败", {
        description: error instanceof Error ? error.message : String(error),
      })
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
      await migrateSensitiveDataToSecureStore()
      const results = await repairLocalDataSchemas(ids)
      const fixed = results.filter((result) => result.ok).length
      toast.success(`已修复 ${fixed}/${results.length} 项`)
      refresh()
    } catch (error) {
      toast.error("批量修复失败", {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setRepairingSchema(null)
    }
  }

  if (!snapshot) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <CodePageHeader />
        <EmptyState icon={Bug} title="正在读取调试信息" bordered />
      </div>
    )
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-4">
      <CodePageHeader
        onRefresh={refresh}
        onCopy={() => void copySnapshot()}
        onDownload={downloadBundle}
        onArchive={() => void exportWorkspaceArchive()}
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

      <RuntimeOverview snapshot={snapshot} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <SecurityPanel diagnostics={security} onMigrate={() => void migrateSensitiveData()} />
        <PluginDataPanel
          entries={pluginData}
          loading={pluginLoading}
          onExport={(pluginId) => void exportPluginData(pluginId)}
          onExportAll={() => void exportWorkspaceBackup()}
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

      <StorageOverview snapshot={snapshot} />
    </div>
  )
}
