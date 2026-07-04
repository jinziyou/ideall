// 本地模式插件入口 (终端 / 音乐等) —— 活动栏「插件」模块与侧栏树共用。
import type { ComponentType } from "react"
import { MODULE_META } from "./module-meta"
import type { TabDescriptor } from "./types"

export type PluginEntry = {
  id: string
  label: string
  icon: ComponentType<{ className?: string }>
  descriptor: TabDescriptor
}

export const PLUGIN_ENTRIES: PluginEntry[] = [
  {
    id: "shell",
    label: MODULE_META.shell.label,
    icon: MODULE_META.shell.icon,
    descriptor: { kind: "shell", module: "shell", title: "终端", path: "/shell" },
  },
  {
    id: "music",
    label: MODULE_META.music.label,
    icon: MODULE_META.music.icon,
    descriptor: { kind: "music", module: "music", title: "音乐", path: "/music" },
  },
]

export const PLUGIN_MODULE_IDS = new Set(PLUGIN_ENTRIES.map((e) => e.descriptor.module))

export function isPluginModule(id: string): boolean {
  return PLUGIN_MODULE_IDS.has(id as (typeof PLUGIN_ENTRIES)[number]["descriptor"]["module"])
}
