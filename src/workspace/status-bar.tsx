"use client"

// 底部状态栏: 当前模块 + 打开标签数 + 命令台入口 (本机设备状态/健康在设置菜单弹层 settings-menu 内)。

import { Command } from "lucide-react"
import { cn } from "@/lib/utils"
import { openCommandPalette } from "@/lib/command-palette-bus"
import { moduleById } from "./modules"
import { useActiveModule, useMode, useTabs } from "./store"
import type { ModuleId } from "./types"

const DOT: Record<ModuleId, string> = {
  home: "bg-primary",
  subscriptions: "bg-spoke-info",
  info: "bg-spoke-info",
  community: "bg-spoke-community",
  browser: "bg-spoke-tool",
  tool: "bg-spoke-tool",
  agent: "bg-primary",
}

export default function StatusBar() {
  const activeModule = useActiveModule()
  const mode = useMode()
  const tabs = useTabs()
  const mod = moduleById(activeModule)

  return (
    <footer className="hidden h-7 shrink-0 items-center gap-3 border-t bg-secondary/40 px-3 text-[11px] text-muted-foreground md:flex">
      <span className="flex items-center gap-1.5">
        <span className={cn("h-1.5 w-1.5 rounded-full", DOT[activeModule])} />
        {mode === "local" ? "本地" : "连接"} · {mod.label}
      </span>
      <span className="tabular-nums">{tabs.length} 个标签</span>
      {/* 命令台入口本地/连接两模式常驻可见; ⌘K 键位本就全局可用, 这里只是补回可见分区。 */}
      <button
        type="button"
        onClick={openCommandPalette}
        className="ml-auto flex items-center gap-1 transition-colors hover:text-foreground"
      >
        <Command className="h-3 w-3" />
        命令台 ⌘K
      </button>
    </footer>
  )
}
