"use client"

// 顶栏中部搜索框: 统一入口, 点击唤起 ⌘K 统一面板 (本地搜索 + 命令; `>` 前缀只看命令)。
// 旧的独立「本地搜索」对话框已并入 ⌘K (职责重复, 见 shell/command-palette)。
import { Search } from "lucide-react"
import { openCommandPalette } from "@/lib/command-palette-bus"

export default function TopSearch() {
  return (
    <button
      type="button"
      onClick={openCommandPalette}
      className="flex h-7 w-full max-w-md items-center gap-2 rounded-shell border bg-background px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <Search className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">搜索本地内容或执行命令…</span>
      <kbd className="ml-auto shrink-0 rounded border bg-muted px-1 font-mono text-[10px]">⌘K</kbd>
    </button>
  )
}
