import { getSyncCode } from "@/lib/sync-code"
import {
  createPluginDataPackage,
  parseExpectedPluginDataPackage,
  stringifyPluginDataPackage,
  type PluginDataPackage,
} from "@/plugins/shared/plugin-data"

export const SYNC_PLUGIN_ID = "sync"
export const SYNC_PLUGIN_LABEL = "同步"
export const SYNC_EXPORT_KIND = "ideall.sync.status"
export const SYNC_EXPORT_VERSION = 1
export const SYNC_DATA_SPEC = {
  pluginId: SYNC_PLUGIN_ID,
  pluginLabel: SYNC_PLUGIN_LABEL,
  dataKind: SYNC_EXPORT_KIND,
  dataVersion: SYNC_EXPORT_VERSION,
} as const

export type SyncStatusPayload = {
  configured: boolean
  codeExported: false
}

export type SyncStatusExport = PluginDataPackage<
  SyncStatusPayload,
  typeof SYNC_EXPORT_KIND,
  typeof SYNC_EXPORT_VERSION
>

export function createSyncStatusExport(
  configured = Boolean(getSyncCode()),
  exportedAt = new Date().toISOString(),
): SyncStatusExport {
  return createPluginDataPackage(SYNC_DATA_SPEC, { configured, codeExported: false }, exportedAt)
}

export function parseSyncStatusExport(raw: string): SyncStatusExport {
  const pack = parseExpectedPluginDataPackage(raw, SYNC_DATA_SPEC)
  const payload =
    pack.payload && typeof pack.payload === "object" && !Array.isArray(pack.payload)
      ? (pack.payload as Partial<SyncStatusPayload>)
      : {}
  return createSyncStatusExport(Boolean(payload.configured), pack.exportedAt)
}

export async function exportSyncStatusJson(): Promise<string> {
  return stringifyPluginDataPackage(createSyncStatusExport())
}

export async function importSyncStatusJson(raw: string): Promise<{ codeImported: false }> {
  parseSyncStatusExport(raw)
  return { codeImported: false }
}

export async function inspectSyncStatusData(): Promise<{
  configured: boolean
  bytes: number
}> {
  const configured = Boolean(getSyncCode())
  return { configured, bytes: configured ? 1 : 0 }
}
