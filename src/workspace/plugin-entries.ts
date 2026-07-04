// 本地模式插件入口 (终端 / Git / 数据库 / 音频 / Debug 等) —— 活动栏「插件」模块与侧栏树共用。
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
    id: "git",
    label: MODULE_META.git.label,
    icon: MODULE_META.git.icon,
    descriptor: { kind: "git", module: "git", title: "Git", path: "/git" },
  },
  {
    id: "database",
    label: MODULE_META.database.label,
    icon: MODULE_META.database.icon,
    descriptor: { kind: "database", module: "database", title: "数据库", path: "/database" },
  },
  {
    id: "audio",
    label: MODULE_META.audio.label,
    icon: MODULE_META.audio.icon,
    descriptor: { kind: "audio", module: "audio", title: "音频播放器", path: "/audio" },
  },
  {
    id: "debug",
    label: MODULE_META.debug.label,
    icon: MODULE_META.debug.icon,
    descriptor: { kind: "debug", module: "debug", title: "Debug", path: "/debug" },
  },
]

export const PLUGIN_MODULE_IDS = new Set(PLUGIN_ENTRIES.map((e) => e.descriptor.module))

export function isPluginModule(id: string): boolean {
  return PLUGIN_MODULE_IDS.has(id as (typeof PLUGIN_ENTRIES)[number]["descriptor"]["module"])
}
