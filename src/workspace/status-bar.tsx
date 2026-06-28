"use client"

// 底部状态栏: 当前模块 + 打开标签数 + 命令台入口 (本机设备状态/健康在设置菜单弹层 settings-menu 内)。

import { Command } from "lucide-react"
import { cn } from "@/lib/utils"
import { openCommandPalette } from "@/lib/command-palette-bus"
import { moduleById } from "./modules"
import { MODULE_DOT } from "./module-dot"
import { useActiveModule, useMode, useTabs } from "./store"

export default function StatusBar() {
  const activeModule = useActiveModule()
  const mode = useMode()
  const tabs = useTabs()
  const mod = moduleById(activeModule)

  return (
    <footer className="hidden h-7 shrink-0 items-center gap-3 border-t bg-secondary/30 px-3 text-[11px] text-muted-foreground md:flex">
      <span className="flex items-center gap-1.5">
        <span className={cn("h-1.5 w-1.5 rounded-full", MODULE_DOT[activeModule])} />
        {mode === "local" ? "本地" : "连接"} · {mod.label}
      </span>
      <span className="tabular-nums">{tabs.length} 个标签</span>
      {/* 命令台入口本地/连接两模式常驻可见; ⌘K 键位本就全局可用, 这里只是补回可见分区。 */}
      <button
        type="button"
        onClick={openCommandPalette}
        className="-mr-1 ml-auto flex items-center gap-1 rounded-shell px-1.5 py-0.5 outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <Command className="h-3 w-3" />
        命令台 ⌘K
      </button>
    </footer>
  )
}
