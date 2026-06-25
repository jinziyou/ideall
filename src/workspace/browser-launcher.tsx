"use client"

// 「浏览器」侧栏 (连接模式): 打开内嵌浏览器标签 (主区, 工具条 + 原生子 webview)。
// 内嵌浏览器仅桌面 App 可用; 网页形态下打开标签后由 BrowserView 提示不可用。
import * as React from "react"
import { Globe } from "lucide-react"
import { isTauri } from "@/lib/tauri"
import { openTab } from "./store"

export default function BrowserLauncher() {
  const tauri = React.useSyncExternalStore(
    () => () => {},
    () => isTauri(),
    () => false,
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <button
        type="button"
        onClick={() => openTab({ kind: "browser-view", module: "browser", title: "浏览器" })}
        className="flex items-center justify-center gap-2 rounded-shell border bg-background px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
      >
        <Globe className="h-4 w-4" />
        打开浏览器
      </button>
      <p className="px-1 text-xs leading-relaxed text-muted-foreground">
        在内嵌浏览器里浏览网页，点工具条的「★ 收藏」把当前页存进书签。
        {!tauri && (
          <span className="mt-1 block text-[11px] text-amber-600 dark:text-amber-500">
            注：内嵌浏览器仅在桌面 App 可用；当前为网页形态。
          </span>
        )}
      </p>
    </div>
  )
}
