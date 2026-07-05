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
