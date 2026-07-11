// 本地模式插件入口 (终端 / Git / 数据库 / 音频 / Code 等) —— 活动栏「插件」模块与侧栏树共用。
import type { ComponentType } from "react"
import { MODULE_META } from "./module-meta"
import { tabDescriptor } from "./tab-definitions"
import type { TabDescriptor } from "./types"
import { fileEngineTab } from "./file-tab"
import { BUILTIN_APP_SURFACES, mountedFileRootId } from "./file-roots"

export type PluginEntry = {
  id: string
  label: string
  icon: ComponentType<{ className?: string }>
  descriptor: TabDescriptor
}

function appSurfaceDescriptor(id: keyof typeof BUILTIN_APP_SURFACES, name: string): TabDescriptor {
  const surface = BUILTIN_APP_SURFACES[id]
  return fileEngineTab({ ref: surface.ref, name }, surface.engineId, {
    module: surface.module,
    rootId: mountedFileRootId(surface.ref),
  })
}

export const PLUGIN_ENTRIES: PluginEntry[] = [
  {
    id: "shell",
    label: MODULE_META.shell.label,
    icon: MODULE_META.shell.icon,
    descriptor: tabDescriptor("shell"),
  },
  {
    id: "git",
    label: MODULE_META.git.label,
    icon: MODULE_META.git.icon,
    descriptor: appSurfaceDescriptor("git", MODULE_META.git.label),
  },
  {
    id: "database",
    label: MODULE_META.database.label,
    icon: MODULE_META.database.icon,
    descriptor: appSurfaceDescriptor("database", MODULE_META.database.label),
  },
  {
    id: "audio",
    label: MODULE_META.audio.label,
    icon: MODULE_META.audio.icon,
    descriptor: appSurfaceDescriptor("audio", MODULE_META.audio.label),
  },
  {
    id: "code",
    label: MODULE_META.code.label,
    icon: MODULE_META.code.icon,
    descriptor: tabDescriptor("code"),
  },
]

export const PLUGIN_MODULE_IDS = new Set(PLUGIN_ENTRIES.map((e) => e.descriptor.module))

export function isPluginModule(id: string): boolean {
  return PLUGIN_MODULE_IDS.has(id as (typeof PLUGIN_ENTRIES)[number]["descriptor"]["module"])
}
