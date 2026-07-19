// sync 插件 manifest —— 向「我的」注册 SyncPort (跨端同步编排)。
// core 的同步面板经 @protocol/sync 的 getSyncPort() 调用, 不直接依赖本插件。
// 一次 syncNow 并发同步关注、笔记、书签三个独立加密块 (各自 storageId, 互不覆盖)。
import { recordSyncTelemetry, registerSyncPort, type SyncFailureCode } from "@protocol/sync"
import { SYNC_CODE_SECURE_KEY } from "@/lib/sync-code"
import { secureFallbackStorageKey } from "@/lib/secure-store"
import type { PluginDataPort } from "@/plugins/shared/plugin-data"
import type { LocalDataSchema } from "@/plugins/shared/local-data-schema"
import {
  SYNC_DATA_SPEC,
  exportSyncStatusJson,
  importSyncStatusJson,
  inspectSyncStatusData,
} from "./lib/sync-data-port"

const syncDataPort: PluginDataPort = {
  ...SYNC_DATA_SPEC,
  filenamePrefix: "ideall-sync",
  importMode: "noop",
  importDescription: "导入只校验同步状态备份, 不写入同步码。",
  exportJson: exportSyncStatusJson,
  importJson: importSyncStatusJson,
  inspect: async () => {
    const info = await inspectSyncStatusData()
    return {
      pluginId: SYNC_DATA_SPEC.pluginId,
      label: SYNC_DATA_SPEC.pluginLabel,
      dataKind: SYNC_DATA_SPEC.dataKind,
      dataVersion: SYNC_DATA_SPEC.dataVersion,
      status: info.configured ? "ready" : "empty",
      itemCount: info.configured ? 1 : 0,
      bytes: info.bytes,
      updatedAt: null,
      detail: info.configured ? "已配置同步码（不导出本体）" : "未配置同步码",
    }
  },
}

const syncLocalDataSchemas: readonly LocalDataSchema[] = [
  {
    id: "sync.code",
    label: "同步码",
    owner: "sync",
    storage: "localStorage",
    key: secureFallbackStorageKey(SYNC_CODE_SECURE_KEY),
    currentVersion: 1,
    storageClass: "secrets",
    sensitive: true,
    parseAs: "text",
    validate: (_value, raw) => (raw.trim() ? ["同步码是本机能力凭证, 不进入插件数据导出"] : []),
  },
]

export const syncManifest = {
  id: "sync" as const,
  dataPorts: [syncDataPort] as const,
  localDataSchemas: syncLocalDataSchemas,
  register() {
    return registerSyncPort({
      syncNow: async (code) => {
        const { runSyncOrchestrator } = await import("./lib/sync-orchestrator-machine")
        const startedAt = Date.now()
        try {
          const result = await runSyncOrchestrator(code)
          const finishedAt = Date.now()
          recordSyncTelemetry({
            status: "success",
            startedAt,
            finishedAt,
            durationMs: finishedAt - startedAt,
            total: result.total,
            added: result.added,
            failureCode: null,
          })
          return result
        } catch (error) {
          const finishedAt = Date.now()
          recordSyncTelemetry({
            status: "failure",
            startedAt,
            finishedAt,
            durationMs: finishedAt - startedAt,
            total: null,
            added: null,
            failureCode: syncFailureCode(error),
          })
          throw error
        }
      },
    })
  },
}

function syncFailureCode(error: unknown): SyncFailureCode {
  const message = error instanceof Error ? error.message : String(error)
  if (/单块上限|域上限|服务端配额|分片数超过|同步(?:记录|明文)超过/.test(message)) {
    return "block-limit"
  }
  if (/冲突|本地变化/.test(message)) return "conflict"
  if (/解密|同步码/.test(message)) return "decrypt"
  if (/拉取|上传|网络|过于频繁|稍后重试|offline|fetch/i.test(message)) return "network"
  return "unknown"
}
