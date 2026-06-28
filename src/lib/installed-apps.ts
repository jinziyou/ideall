// 本机已安装应用 —— Tauri 命令封装 (list / launch / icon); 纯浏览器 dev 无此能力。

import { isTauri } from "@/lib/tauri"

export type InstalledApp = {
  id: string
  name: string
  comment?: string | null
  categories: string[]
  iconPath?: string | null
}

/** 列举本机已安装应用 (仅 Tauri 桌面); 非 App 返回空数组。 */
export async function listInstalledApps(): Promise<InstalledApp[]> {
  if (!isTauri()) return []
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<InstalledApp[]>("list_installed_apps")
}

/** 启动指定应用 (按 .desktop id / .app 名 / 快捷方式名)。 */
export async function launchInstalledApp(id: string): Promise<void> {
  if (!isTauri()) {
    throw new Error("仅桌面 App 可启动本机应用")
  }
  const { invoke } = await import("@tauri-apps/api/core")
  await invoke("launch_installed_app", { id })
}

const iconCache = new Map<string, string | null>()

/** 读取应用图标为 data URL (Rust 侧读文件, 不依赖 asset 协议 scope)。 */
export async function appIconSrc(iconPath: string | null | undefined): Promise<string | null> {
  if (!iconPath || !isTauri()) return null
  if (iconCache.has(iconPath)) return iconCache.get(iconPath) ?? null
  const { invoke } = await import("@tauri-apps/api/core")
  const url = await invoke<string | null>("read_app_icon_data_url", { path: iconPath })
  iconCache.set(iconPath, url)
  return url
}
