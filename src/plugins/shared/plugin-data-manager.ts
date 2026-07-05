import {
  parsePluginDataPackage,
  pluginDataErrorInspection,
  type PluginDataInspection,
  type PluginDataPackage,
  type PluginDataPort,
  type PluginImportResult,
} from "./plugin-data"
import { PLUGIN_DATA_PORTS } from "./plugin-data-registry"

export type PluginDataImportPreview = {
  ok: boolean
  filename?: string
  error?: string
  package?: {
    pluginId: string
    pluginLabel: string
    dataKind: string
    dataVersion: number
    exportedAt: string
  }
  target?: {
    pluginId: string
    pluginLabel: string
    dataKind: string
    dataVersion: number
    importMode: NonNullable<PluginDataPort["importMode"]>
    importDescription: string
  }
  current?: PluginDataInspection
}

export type PluginDataImportExecution = {
  preview: PluginDataImportPreview
  backup: PluginDataImportBackup | null
  result: PluginImportResult
  after: PluginDataInspection
}

export type PluginDataImportBackup = {
  pluginId: string
  pluginLabel: string
  dataKind: string
  dataVersion: number
  createdAt: string
  raw: string
  bytes: number
}

export type PluginDataRestoreExecution = {
  result: PluginImportResult
  after: PluginDataInspection
}

function bytesOf(raw: string): number {
  return new TextEncoder().encode(raw).byteLength
}

function packageSummary(pack: PluginDataPackage): NonNullable<PluginDataImportPreview["package"]> {
  return {
    pluginId: pack.plugin.id,
    pluginLabel: pack.plugin.label,
    dataKind: pack.plugin.dataKind,
    dataVersion: pack.plugin.dataVersion,
    exportedAt: pack.exportedAt,
  }
}

function portSummary(port: PluginDataPort): NonNullable<PluginDataImportPreview["target"]> {
  return {
    pluginId: port.pluginId,
    pluginLabel: port.pluginLabel,
    dataKind: port.dataKind,
    dataVersion: port.dataVersion,
    importMode: port.importMode ?? "replace",
    importDescription: port.importDescription ?? "导入后按插件默认策略写入本地数据。",
  }
}

async function inspectPort(port: PluginDataPort): Promise<PluginDataInspection> {
  try {
    return await port.inspect()
  } catch (error) {
    return pluginDataErrorInspection(port, error)
  }
}

async function createImportBackup(port: PluginDataPort): Promise<PluginDataImportBackup | null> {
  if ((port.importMode ?? "replace") === "noop") return null
  const raw = await port.exportJson()
  return {
    pluginId: port.pluginId,
    pluginLabel: port.pluginLabel,
    dataKind: port.dataKind,
    dataVersion: port.dataVersion,
    createdAt: new Date().toISOString(),
    raw,
    bytes: bytesOf(raw),
  }
}

export function pluginDataPortForPackage(
  pack: Pick<PluginDataPackage, "plugin">,
  ports: readonly PluginDataPort[] = PLUGIN_DATA_PORTS,
): PluginDataPort | undefined {
  return ports.find(
    (port) =>
      port.pluginId === pack.plugin.id &&
      port.dataKind === pack.plugin.dataKind &&
      port.dataVersion === pack.plugin.dataVersion,
  )
}

export async function previewPluginDataImport(
  raw: string,
  filename?: string,
  ports: readonly PluginDataPort[] = PLUGIN_DATA_PORTS,
): Promise<PluginDataImportPreview> {
  let pack: PluginDataPackage
  try {
    pack = parsePluginDataPackage(raw)
  } catch (error) {
    return {
      ok: false,
      filename,
      error: error instanceof Error ? error.message : String(error),
    }
  }

  const samePlugin = ports.find((port) => port.pluginId === pack.plugin.id)
  const port = pluginDataPortForPackage(pack, ports)
  if (!port) {
    return {
      ok: false,
      filename,
      package: packageSummary(pack),
      error: samePlugin
        ? `不支持的${samePlugin.pluginLabel}插件数据版本`
        : `未找到插件数据端口: ${pack.plugin.id}`,
    }
  }

  return {
    ok: true,
    filename,
    package: packageSummary(pack),
    target: portSummary(port),
    current: await inspectPort(port),
  }
}

export async function importPluginDataPackage(
  raw: string,
  filename?: string,
  ports: readonly PluginDataPort[] = PLUGIN_DATA_PORTS,
): Promise<PluginDataImportExecution> {
  const preview = await previewPluginDataImport(raw, filename, ports)
  if (!preview.ok || !preview.package) {
    throw new Error(preview.error ?? "插件数据无法导入")
  }
  const pack = parsePluginDataPackage(raw)
  const port = pluginDataPortForPackage(pack, ports)
  if (!port) throw new Error(preview.error ?? "插件数据端口不存在")
  const backup = await createImportBackup(port)
  let result: PluginImportResult
  try {
    result = await port.importJson(raw)
  } catch (error) {
    if (backup) {
      try {
        await restorePluginDataBackup(backup, ports)
      } catch {
        /* 保留原始导入错误; 恢复失败可从后续诊断继续处理。 */
      }
    }
    throw error
  }
  return { preview, backup, result, after: await inspectPort(port) }
}

export async function restorePluginDataBackup(
  backup: PluginDataImportBackup,
  ports: readonly PluginDataPort[] = PLUGIN_DATA_PORTS,
): Promise<PluginDataRestoreExecution> {
  const pack = parsePluginDataPackage(backup.raw)
  const port = pluginDataPortForPackage(pack, ports)
  if (!port) throw new Error(`备份对应的插件数据端口不存在: ${backup.pluginId}`)
  const result = await port.importJson(backup.raw)
  return { result, after: await inspectPort(port) }
}

export function formatPluginImportResult(result: PluginImportResult): string {
  const entries = Object.entries(result)
  if (!entries.length) return "已完成"
  return entries.map(([key, value]) => `${key}: ${String(value)}`).join(" / ")
}
