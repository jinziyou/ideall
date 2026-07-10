import { BUILTIN_ENGINES, engineRegistry } from "@/engines/builtin"
import { mountFileSystem } from "@/filesystem/composite-root"
import { ideallRootFileSystem } from "@/filesystem/builtin"
import { fileSystemRegistry } from "@/filesystem/registry"
import { registerAudioFileSystem } from "./audio-file-system"

// 音频既是可处理 audio/* 的引擎，也是保留现有 IndexedDB Blob 的 App 文件系统挂载。
export const audioManifest = {
  id: "audio" as const,
  engines: ["ideall.audio"] as const,
  register() {
    const descriptor = BUILTIN_ENGINES.find((engine) => engine.engineId === "ideall.audio")
    if (descriptor && !engineRegistry.get(descriptor.engineId)) engineRegistry.register(descriptor)
    registerAudioFileSystem((provider) => {
      mountFileSystem(fileSystemRegistry, ideallRootFileSystem, provider, {
        entryId: "app.audio-library",
        name: "音频库",
      })
    })
  },
}
