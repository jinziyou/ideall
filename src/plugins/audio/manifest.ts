import * as React from "react"
import { BUILTIN_ENGINES, engineRegistry } from "@/engines/builtin"
import { mountFileSystem } from "@/filesystem/composite-root"
import { ideallRootFileSystem } from "@/filesystem/builtin"
import { fileSystemRegistry } from "@/filesystem/registry"
import { registerAudioFileSystem } from "./audio-file-system"
import {
  AUDIO_DATA_SPEC,
  AUDIO_DB_NAME,
  AUDIO_DB_VERSION,
  exportAudioLibraryJson,
  inspectAudioLibraryData,
} from "./audio-store"
import { importAudioLibraryJsonWithRootLock } from "./audio-write-adapter"
import type { PluginDataPort } from "@/plugins/shared/plugin-data"
import type { LocalDataSchema } from "@/plugins/shared/local-data-schema"

const AudioPage = React.lazy(() => import("./audio-page"))

const audioDataPort: PluginDataPort = {
  ...AUDIO_DATA_SPEC,
  filenamePrefix: "ideall-audio",
  importMode: "replace",
  importDescription: "导入会替换当前音频播放列表和播放状态。",
  exportJson: exportAudioLibraryJson,
  importJson: importAudioLibraryJsonWithRootLock,
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
}

const audioLocalDataSchemas: readonly LocalDataSchema[] = [
  {
    id: "audio.db",
    label: "音频播放列表",
    owner: "audio",
    storage: "indexedDB",
    key: AUDIO_DB_NAME,
    currentVersion: AUDIO_DB_VERSION,
    portable: true,
  },
]

// 音频既是可处理 audio/* 的引擎，也是保留现有 IndexedDB Blob 的 App 文件系统挂载。
export const audioManifest = {
  id: "audio" as const,
  engines: ["ideall.audio"] as const,
  dataPorts: [audioDataPort] as const,
  localDataSchemas: audioLocalDataSchemas,
  renderLibraryRoot() {
    return React.createElement(AudioPage)
  },
  register() {
    const disposers: Array<() => void> = []
    const descriptor = BUILTIN_ENGINES.find((engine) => engine.engineId === "ideall.audio")
    if (descriptor && !engineRegistry.get(descriptor.engineId)) {
      disposers.push(engineRegistry.register(descriptor))
    }
    disposers.push(
      registerAudioFileSystem((provider) =>
        mountFileSystem(fileSystemRegistry, ideallRootFileSystem, provider, {
          entryId: "app.audio-library",
          name: "音频库",
          properties: { navigationHidden: true },
        }),
      ),
    )
    return () => {
      for (const dispose of disposers.reverse()) dispose()
    }
  },
}
