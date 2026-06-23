"use client"

// 顶栏快捷布局切换: 左侧栏开关 + 右侧 AI 对话栏开关 (Trae/VS Code 风格)。
import { MessageSquare, PanelLeft } from "lucide-react"
import { cn } from "@/components/lib/utils"
import {
  useSidebarCollapsed,
  useRightPanelOpen,
  toggleSidebar,
  toggleRightPanel,
} from "./store"

export default function LayoutToggles() {
  const sidebarCollapsed = useSidebarCollapsed()
  const rightOpen = useRightPanelOpen()

  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        onClick={toggleSidebar}
        title="侧栏"
        aria-label="切换侧栏"
        aria-pressed={!sidebarCollapsed}
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-shell transition-colors hover:bg-accent",
          sidebarCollapsed ? "text-muted-foreground" : "text-foreground",
        )}
      >
        <PanelLeft className="h-[1.05rem] w-[1.05rem]" />
      </button>
      <button
        type="button"
        onClick={toggleRightPanel}
        title="AI 对话栏"
        aria-label="切换 AI 对话栏"
        aria-pressed={rightOpen}
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-shell transition-colors hover:bg-accent",
          rightOpen ? "text-primary" : "text-muted-foreground",
        )}
      >
        <MessageSquare className="h-[1.05rem] w-[1.05rem]" />
      </button>
    </div>
  )
}
