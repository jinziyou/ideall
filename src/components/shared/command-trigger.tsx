"use client"

import { Search } from "lucide-react"
import { cn } from "@/components/lib/utils"
import { openCommandPalette } from "@/components/lib/command-palette-bus"

/**
 * 可见的命令台触发器 (药丸形) —— 方案 3 混合: ⌘K 浮层引擎 + 显式入口。
 * 用于移动顶栏与各页页头 (页头右上「⌕ 命令 ⌘K」), 点击即唤起全局命令台。
 */
export default function CommandTrigger({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={openCommandPalette}
      className={cn(
        "flex h-9 items-center gap-2 rounded-lg border border-input bg-background px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
        className,
      )}
    >
      <Search className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-left">跳到书签、切换主题、问 AI…</span>
      <kbd className="hidden rounded border bg-muted px-1.5 font-sans text-[10px] lg:inline">
        ⌘K
      </kbd>
    </button>
  )
}
