import {
  AUDIO_DATA_SPEC,
  exportAudioLibraryJson,
  importAudioLibraryJson,
  inspectAudioLibraryData,
} from "@/plugins/audio/audio-store"
import {
  DATABASE_DATA_SPEC,
  exportDatabaseJson,
  importDatabaseJson,
  inspectDatabaseData,
} from "@/plugins/database/database-store"
import {
  GIT_DATA_SPEC,
  exportGitReposJson,
  importGitReposJson,
  inspectGitReposData,
} from "@/plugins/git/git-repos-store"
import {
  AGENT_DATA_SPEC,
  exportAgentConfigJson,
  importAgentConfigJson,
  inspectAgentConfigData,
} from "@/plugins/agent/lib/agent-data-port"
import {
  SYNC_DATA_SPEC,
  exportSyncStatusJson,
  importSyncStatusJson,
  inspectSyncStatusData,
} from "@/plugins/sync/lib/sync-data-port"
import {
  pluginDataErrorInspection,
  type PluginDataInspection,
  type PluginDataPort,
} from "./plugin-data"

export type { PluginDataInspection } from "./plugin-data"

export const PLUGIN_DATA_PORTS: PluginDataPort[] = [
  {
    ...AUDIO_DATA_SPEC,
    filenamePrefix: "ideall-audio",
    exportJson: exportAudioLibraryJson,
    importJson: importAudioLibraryJson,
    inspect: async () => {
      const info = await inspectAudioLibraryData()
      return {
        pluginId: AUDIO_DATA_SPEC.pluginId,
        label: AUDIO_DATA_SPEC.pluginLabel,
        dataKind: AUDIO_DATA_SPEC.dataKind,
        dataVersion: AUDIO_DATA_SPEC.dataVersion,
        status: info.tracks > 0 ? "ready" : "empty",
        itemCount: info.tracks,
        bytes: info.bytes,
        updatedAt: info.updatedAt,
        detail: `${info.tracks} 首音频`,
      }
    },
  },
  {
    ...DATABASE_DATA_SPEC,
    filenamePrefix: "ideall-database",
    exportJson: exportDatabaseJson,
    importJson: importDatabaseJson,
    inspect: async () => {
      const info = await inspectDatabaseData()
      return {
        pluginId: DATABASE_DATA_SPEC.pluginId,
        label: DATABASE_DATA_SPEC.pluginLabel,
        dataKind: DATABASE_DATA_SPEC.dataKind,
        dataVersion: DATABASE_DATA_SPEC.dataVersion,
        status: info.tables > 0 ? "ready" : "empty",
        itemCount: info.tables + info.rows,
        bytes: info.bytes,
        updatedAt: info.updatedAt,
        detail: `${info.tables} 张表 / ${info.rows} 行`,
      }
    },
  },
  {
    ...GIT_DATA_SPEC,
    filenamePrefix: "ideall-git",
    exportJson: exportGitReposJson,
    importJson: importGitReposJson,
    inspect: async () => {
      const info = await inspectGitReposData()
      return {
        pluginId: GIT_DATA_SPEC.pluginId,
        label: GIT_DATA_SPEC.pluginLabel,
        dataKind: GIT_DATA_SPEC.dataKind,
        dataVersion: GIT_DATA_SPEC.dataVersion,
        status: info.repos > 0 ? "ready" : "empty",
        itemCount: info.repos,
        bytes: info.bytes,
        updatedAt: info.updatedAt,
        detail: `${info.repos} 个仓库`,
      }
    },
  },
  {
    ...AGENT_DATA_SPEC,
    filenamePrefix: "ideall-agent",
    exportJson: exportAgentConfigJson,
    importJson: importAgentConfigJson,
    inspect: async () => {
      const info = await inspectAgentConfigData()
      return {
        pluginId: AGENT_DATA_SPEC.pluginId,
        label: AGENT_DATA_SPEC.pluginLabel,
        dataKind: AGENT_DATA_SPEC.dataKind,
        dataVersion: AGENT_DATA_SPEC.dataVersion,
        status: info.keys > 0 ? "ready" : "empty",
        itemCount: info.keys,
        bytes: info.bytes,
        updatedAt: info.keys ? Date.now() : null,
        detail:
          info.localSensitiveValues > 0
            ? `${info.keys} 组配置 / ${info.localSensitiveValues} 项待迁移敏感值`
            : `${info.keys} 组配置`,
      }
    },
  },
  {
    ...SYNC_DATA_SPEC,
    filenamePrefix: "ideall-sync",
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
  },
]

export function pluginDataPortById(id: string): PluginDataPort | undefined {
  return PLUGIN_DATA_PORTS.find((port) => port.pluginId === id)
}

export async function inspectPluginDataPorts(): Promise<PluginDataInspection[]> {
  return Promise.all(
    PLUGIN_DATA_PORTS.map(async (port) => {
      try {
        return await port.inspect()
      } catch (error) {
        return pluginDataErrorInspection(port, error)
      }
    }),
  )
}
