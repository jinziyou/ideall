import {
  createWorkspaceBackupPackage,
  parsePluginDataPackage,
  parseWorkspaceBackupPackage,
  pluginDataErrorInspection,
  stringifyWorkspaceBackupPackage,
  type PluginDataInspection,
  type PluginDataPackage,
  type PluginDataPort,
  type PluginImportResult,
  type WorkspaceBackupPackage,
} from "./plugin-data"
import { listPluginDataPorts } from "./plugin-data-registry"

const WORKSPACE_BACKUP_ID = "workspace"
const WORKSPACE_BACKUP_LABEL = "全部插件"
const WORKSPACE_BACKUP_DATA_KIND = "ideall.workspace-backup"
const WORKSPACE_BACKUP_DATA_VERSION = 1

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
  workspace?: {
    pluginCount: number
    plugins: {
      pluginId: string
      pluginLabel: string
      dataKind: string
      dataVersion: number
    }[]
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

function isWorkspaceBackupRaw(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw) as { kind?: unknown }
    return parsed?.kind === WORKSPACE_BACKUP_DATA_KIND
  } catch {
    return false
  }
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

function workspacePackageSummary(
  pack: WorkspaceBackupPackage,
): NonNullable<PluginDataImportPreview["package"]> {
  return {
    pluginId: WORKSPACE_BACKUP_ID,
    pluginLabel: WORKSPACE_BACKUP_LABEL,
    dataKind: WORKSPACE_BACKUP_DATA_KIND,
    dataVersion: WORKSPACE_BACKUP_DATA_VERSION,
    exportedAt: pack.exportedAt,
  }
}

function workspaceTargetSummary(): NonNullable<PluginDataImportPreview["target"]> {
  return {
    pluginId: WORKSPACE_BACKUP_ID,
    pluginLabel: WORKSPACE_BACKUP_LABEL,
    dataKind: WORKSPACE_BACKUP_DATA_KIND,
    dataVersion: WORKSPACE_BACKUP_DATA_VERSION,
    importMode: "replace",
    importDescription: "导入会按插件端口逐项恢复所有可识别插件数据，并创建导入前全量备份。",
  }
}

function workspaceInspection(
  pack: WorkspaceBackupPackage,
  bytes = bytesOf(stringifyWorkspaceBackupPackage(pack)),
): PluginDataInspection {
  return {
    pluginId: WORKSPACE_BACKUP_ID,
    label: WORKSPACE_BACKUP_LABEL,
    dataKind: WORKSPACE_BACKUP_DATA_KIND,
    dataVersion: WORKSPACE_BACKUP_DATA_VERSION,
    status: pack.plugins.length ? "ready" : "empty",
    itemCount: pack.plugins.length,
    bytes,
    updatedAt: Number.isFinite(Date.parse(pack.exportedAt)) ? Date.parse(pack.exportedAt) : null,
    detail: `${pack.plugins.length} 个插件数据包`,
  }
}

function workspacePreviewPayload(
  pack: WorkspaceBackupPackage,
): NonNullable<PluginDataImportPreview["workspace"]> {
  return {
    pluginCount: pack.plugins.length,
    plugins: pack.plugins.map((plugin) => ({
      pluginId: plugin.plugin.id,
      pluginLabel: plugin.plugin.label,
      dataKind: plugin.plugin.dataKind,
      dataVersion: plugin.plugin.dataVersion,
    })),
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

async function createWorkspaceImportBackup(
  ports: readonly PluginDataPort[] = listPluginDataPorts(),
): Promise<PluginDataImportBackup> {
  const raw = await exportWorkspaceBackupJson(ports)
  return {
    pluginId: WORKSPACE_BACKUP_ID,
    pluginLabel: WORKSPACE_BACKUP_LABEL,
    dataKind: WORKSPACE_BACKUP_DATA_KIND,
    dataVersion: WORKSPACE_BACKUP_DATA_VERSION,
    createdAt: new Date().toISOString(),
    raw,
    bytes: bytesOf(raw),
  }
}

export function pluginDataPortForPackage(
  pack: Pick<PluginDataPackage, "plugin">,
  ports: readonly PluginDataPort[] = listPluginDataPorts(),
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
  ports: readonly PluginDataPort[] = listPluginDataPorts(),
): Promise<PluginDataImportPreview> {
  if (isWorkspaceBackupRaw(raw)) {
    let pack: WorkspaceBackupPackage
    try {
      pack = parseWorkspaceBackupPackage(raw)
    } catch (error) {
      return {
        ok: false,
        filename,
        error: error instanceof Error ? error.message : String(error),
      }
    }
    const missing = pack.plugins.find((plugin) => !pluginDataPortForPackage(plugin, ports))
    if (missing) {
      const samePlugin = ports.find((port) => port.pluginId === missing.plugin.id)
      return {
        ok: false,
        filename,
        package: workspacePackageSummary(pack),
        workspace: workspacePreviewPayload(pack),
        error: samePlugin
          ? `不支持的${samePlugin.pluginLabel}插件数据版本`
          : `未找到插件数据端口: ${missing.plugin.id}`,
      }
    }
    return {
      ok: true,
      filename,
      package: workspacePackageSummary(pack),
      target: workspaceTargetSummary(),
      workspace: workspacePreviewPayload(pack),
      current: workspaceInspection(pack, bytesOf(raw)),
    }
  }

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
  ports: readonly PluginDataPort[] = listPluginDataPorts(),
): Promise<PluginDataImportExecution> {
  if (isWorkspaceBackupRaw(raw)) {
    return importWorkspaceBackupPackage(raw, filename, ports)
  }
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

export async function exportWorkspaceBackupJson(
  ports: readonly PluginDataPort[] = listPluginDataPorts(),
): Promise<string> {
  const plugins = await Promise.all(
    ports.map(async (port) => parsePluginDataPackage(await port.exportJson())),
  )
  return stringifyWorkspaceBackupPackage(createWorkspaceBackupPackage(plugins))
}

async function applyWorkspaceBackupPackage(
  pack: WorkspaceBackupPackage,
  ports: readonly PluginDataPort[],
): Promise<PluginImportResult> {
  let imported = 0
  let noop = 0
  for (const plugin of pack.plugins) {
    const port = pluginDataPortForPackage(plugin, ports)
    if (!port) throw new Error(`插件数据端口不存在: ${plugin.plugin.id}`)
    await port.importJson(JSON.stringify(plugin))
    if ((port.importMode ?? "replace") === "noop") noop += 1
    else imported += 1
  }
  return { plugins: pack.plugins.length, imported, noop }
}

export async function importWorkspaceBackupPackage(
  raw: string,
  filename?: string,
  ports: readonly PluginDataPort[] = listPluginDataPorts(),
): Promise<PluginDataImportExecution> {
  const preview = await previewPluginDataImport(raw, filename, ports)
  if (!preview.ok || !preview.package) {
    throw new Error(preview.error ?? "工作区备份无法导入")
  }
  const pack = parseWorkspaceBackupPackage(raw)
  const backup = await createWorkspaceImportBackup(ports)
  let result: PluginImportResult
  try {
    result = await applyWorkspaceBackupPackage(pack, ports)
  } catch (error) {
    try {
      await restorePluginDataBackup(backup, ports)
    } catch {
      /* 保留原始导入错误; 备份仍在 UI 中可手动恢复。 */
    }
    throw error
  }
  return { preview, backup, result, after: workspaceInspection(pack, bytesOf(raw)) }
}

export async function restorePluginDataBackup(
  backup: PluginDataImportBackup,
  ports: readonly PluginDataPort[] = listPluginDataPorts(),
): Promise<PluginDataRestoreExecution> {
  if (isWorkspaceBackupRaw(backup.raw)) {
    const pack = parseWorkspaceBackupPackage(backup.raw)
    const result = await applyWorkspaceBackupPackage(pack, ports)
    return { result, after: workspaceInspection(pack, backup.bytes) }
  }
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
