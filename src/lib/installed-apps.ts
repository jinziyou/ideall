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

export function installedAppIconRequest(appId: string): {
  command: "read_app_icon_data_url"
  args: { id: string }
} {
  return { command: "read_app_icon_data_url", args: { id: appId } }
}

/** 按 opaque app id 读取图标；canonical 路径只在 Rust 侧重解析，不进入命令参数。 */
export async function appIconSrc(appId: string | null | undefined): Promise<string | null> {
  if (!appId || !isTauri()) return null
  if (iconCache.has(appId)) return iconCache.get(appId) ?? null
  try {
    const { invoke } = await import("@tauri-apps/api/core")
    const request = installedAppIconRequest(appId)
    const url = await invoke<string | null>(request.command, request.args)
    iconCache.set(appId, url)
    return url
  } catch {
    iconCache.set(appId, null)
    return null
  }
}
