export const PLUGIN_DATA_PACKAGE_KIND = "ideall.plugin-data"
export const PLUGIN_DATA_PACKAGE_VERSION = 1
export const WORKSPACE_BACKUP_PACKAGE_KIND = "ideall.workspace-backup"
export const WORKSPACE_BACKUP_PACKAGE_VERSION = 1

export type PluginDataPackage<
  TPayload = unknown,
  TDataKind extends string = string,
  TDataVersion extends number = number,
> = {
  kind: typeof PLUGIN_DATA_PACKAGE_KIND
  version: typeof PLUGIN_DATA_PACKAGE_VERSION
  plugin: {
    id: string
    label: string
    dataKind: TDataKind
    dataVersion: TDataVersion
  }
  exportedAt: string
  payload: TPayload
}

export type WorkspaceBackupPackage = {
  kind: typeof WORKSPACE_BACKUP_PACKAGE_KIND
  version: typeof WORKSPACE_BACKUP_PACKAGE_VERSION
  exportedAt: string
  plugins: PluginDataPackage[]
}

export type PluginDataSpec<
  TDataKind extends string = string,
  TDataVersion extends number = number,
> = {
  pluginId: string
  pluginLabel: string
  dataKind: TDataKind
  dataVersion: TDataVersion
}

export type PluginImportResult = Record<string, number | string | boolean | null>

export type PluginDataInspection = {
  pluginId: string
  label: string
  dataKind: string
  dataVersion: number
  status: "ready" | "empty" | "error"
  itemCount: number
  bytes: number
  updatedAt: number | null
  detail: string
  error?: string
}

export type PluginDataPort<TImportResult = PluginImportResult> = PluginDataSpec & {
  filenamePrefix: string
  importMode?: "replace" | "merge" | "noop"
  importDescription?: string
  exportJson: () => Promise<string>
  importJson: (raw: string) => Promise<TImportResult>
  inspect: () => Promise<PluginDataInspection>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${label} 格式无效`)
  return value
}

function requireVersion(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`${label} 格式无效`)
  }
  return value
}

export function createPluginDataPackage<
  TPayload,
  TDataKind extends string,
  TDataVersion extends number,
>(
  spec: PluginDataSpec<TDataKind, TDataVersion>,
  payload: TPayload,
  exportedAt = new Date().toISOString(),
): PluginDataPackage<TPayload, TDataKind, TDataVersion> {
  return {
    kind: PLUGIN_DATA_PACKAGE_KIND,
    version: PLUGIN_DATA_PACKAGE_VERSION,
    plugin: {
      id: spec.pluginId,
      label: spec.pluginLabel,
      dataKind: spec.dataKind,
      dataVersion: spec.dataVersion,
    },
    exportedAt,
    payload,
  }
}

export function parsePluginDataPackage(raw: string): PluginDataPackage {
  const parsed = JSON.parse(raw) as unknown
  if (!isRecord(parsed)) throw new Error("插件数据 JSON 格式无效")
  if (parsed.kind !== PLUGIN_DATA_PACKAGE_KIND || parsed.version !== PLUGIN_DATA_PACKAGE_VERSION) {
    throw new Error("不支持的插件数据 JSON 版本")
  }
  if (!isRecord(parsed.plugin)) throw new Error("插件数据缺少 plugin 元信息")
  return {
    kind: PLUGIN_DATA_PACKAGE_KIND,
    version: PLUGIN_DATA_PACKAGE_VERSION,
    plugin: {
      id: requireString(parsed.plugin.id, "plugin.id"),
      label: requireString(parsed.plugin.label, "plugin.label"),
      dataKind: requireString(parsed.plugin.dataKind, "plugin.dataKind"),
      dataVersion: requireVersion(parsed.plugin.dataVersion, "plugin.dataVersion"),
    },
    exportedAt: requireString(parsed.exportedAt, "exportedAt"),
    payload: parsed.payload,
  }
}

export function createWorkspaceBackupPackage(
  plugins: PluginDataPackage[],
  exportedAt = new Date().toISOString(),
): WorkspaceBackupPackage {
  return {
    kind: WORKSPACE_BACKUP_PACKAGE_KIND,
    version: WORKSPACE_BACKUP_PACKAGE_VERSION,
    exportedAt,
    plugins,
  }
}

export function parseWorkspaceBackupPackage(raw: string): WorkspaceBackupPackage {
  const parsed = JSON.parse(raw) as unknown
  if (!isRecord(parsed)) throw new Error("工作区备份 JSON 格式无效")
  if (
    parsed.kind !== WORKSPACE_BACKUP_PACKAGE_KIND ||
    parsed.version !== WORKSPACE_BACKUP_PACKAGE_VERSION
  ) {
    throw new Error("不支持的工作区备份 JSON 版本")
  }
  if (!Array.isArray(parsed.plugins)) throw new Error("工作区备份缺少 plugins 列表")
  return {
    kind: WORKSPACE_BACKUP_PACKAGE_KIND,
    version: WORKSPACE_BACKUP_PACKAGE_VERSION,
    exportedAt: requireString(parsed.exportedAt, "exportedAt"),
    plugins: parsed.plugins.map((plugin, index) => {
      try {
        return parsePluginDataPackage(JSON.stringify(plugin))
      } catch (error) {
        throw new Error(
          `plugins[${index}] ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }),
  }
}

export function stringifyWorkspaceBackupPackage(pack: WorkspaceBackupPackage): string {
  return JSON.stringify(pack, null, 2)
}

export function parseExpectedPluginDataPackage<
  TDataKind extends string,
  TDataVersion extends number,
>(
  raw: string,
  spec: PluginDataSpec<TDataKind, TDataVersion>,
): PluginDataPackage<unknown, TDataKind, TDataVersion> {
  const pack = parsePluginDataPackage(raw)
  if (
    pack.plugin.id !== spec.pluginId ||
    pack.plugin.dataKind !== spec.dataKind ||
    pack.plugin.dataVersion !== spec.dataVersion
  ) {
    throw new Error(`不支持的${spec.pluginLabel}插件数据版本`)
  }
  return pack as PluginDataPackage<unknown, TDataKind, TDataVersion>
}

export function stringifyPluginDataPackage(pack: PluginDataPackage): string {
  return JSON.stringify(pack, null, 2)
}

export function pluginDataFilename(prefix: string, at = new Date()): string {
  const stamp = at.toISOString().replace(/[:.]/g, "-")
  return `${prefix}-${stamp}.json`
}

export function pluginDataErrorInspection(
  port: Pick<PluginDataPort, "pluginId" | "pluginLabel" | "dataKind" | "dataVersion">,
  error: unknown,
): PluginDataInspection {
  return {
    pluginId: port.pluginId,
    label: port.pluginLabel,
    dataKind: port.dataKind,
    dataVersion: port.dataVersion,
    status: "error",
    itemCount: 0,
    bytes: 0,
    updatedAt: null,
    detail: "读取失败",
    error: error instanceof Error ? error.message : String(error),
  }
}
