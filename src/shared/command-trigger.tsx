"use client"

import { Search } from "lucide-react"
import { cn } from "@/lib/utils"
import { openCommandPalette } from "@/lib/command-palette-bus"

/**
 * 可见的 ⌘K 统一面板触发器 (药丸形): 本地搜索 + 命令的单一入口 (桌面顶栏另有 TopSearch 同款)。
 * 用于移动顶栏与各页页头, 点击即唤起全局统一面板。
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
      <span className="min-w-0 flex-1 truncate text-left">搜索本地内容或执行命令…</span>
      <kbd className="hidden rounded border bg-muted px-1.5 font-sans text-[10px] lg:inline">
        ⌘K
      </kbd>
    </button>
  )
}
