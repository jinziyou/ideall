"use client"

// 顶栏布局开关组 (Trae 式): 左二级侧栏 + 右 AI 侧栏, 紧邻排列; 设置等在分隔线右侧。
import { PanelLeft, PanelRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { useSidebarCollapsed, useRightPanelOpen, toggleSidebar, toggleRightPanel } from "./store"

const btnClass = (active: boolean) =>
  cn(
    "flex h-8 w-8 items-center justify-center rounded-shell outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
    active ? "bg-accent text-foreground" : "text-muted-foreground",
  )

/** Tauri 拖拽区会吞掉 mousedown; 阻止冒泡保证按钮可点。 */
function stopDrag(e: React.MouseEvent) {
  e.stopPropagation()
}

export default function LayoutToggles() {
  const sidebarCollapsed = useSidebarCollapsed()
  const aiOpen = useRightPanelOpen()

  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        onMouseDown={stopDrag}
        onClick={() => toggleSidebar()}
        title="侧栏"
        aria-label="切换侧栏"
        aria-pressed={!sidebarCollapsed}
        className={btnClass(!sidebarCollapsed)}
      >
        <PanelLeft className="h-[1.05rem] w-[1.05rem]" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onMouseDown={stopDrag}
        onClick={() => toggleRightPanel()}
        title="AI 侧栏"
        aria-label="AI 侧栏"
        aria-pressed={aiOpen}
        className={btnClass(aiOpen)}
      >
        <PanelRight className="h-[1.05rem] w-[1.05rem]" strokeWidth={1.75} />
      </button>
    </div>
  )
}
