"use client"

// 顶栏快捷布局切换: 左侧栏开关。
// 旧的右侧 AI 对话栏开关 (MessageSquare) 已移除 —— 活动栏 Bot 钮即对话开关 (两端 AI 主入口
// 语义统一后, 顶栏不再放重复入口)。
import { PanelLeft } from "lucide-react"
import { cn } from "@/lib/utils"
import { useSidebarCollapsed, toggleSidebar } from "./store"

export default function LayoutToggles() {
  const sidebarCollapsed = useSidebarCollapsed()

  return (
    <button
      type="button"
      onClick={toggleSidebar}
      title="侧栏"
      aria-label="切换侧栏"
      aria-pressed={!sidebarCollapsed}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-shell outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        sidebarCollapsed ? "text-muted-foreground" : "text-foreground",
      )}
    >
      <PanelLeft className="h-[1.05rem] w-[1.05rem]" />
    </button>
  )
}
