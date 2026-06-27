"use client"

// 右侧 AI 对话栏 (AI 原生): 桌面右停靠列, 移动端全屏覆盖。承载 AgentPanel (紧凑模式)。
// 与左侧「AI」区并存: 右栏 = 轻量随手对话; 顶部「展开」升级为当前工作空间的任务标签。
import { Bot, Maximize2, X } from "lucide-react"
import AgentPanel from "@/plugins/agent/views/agent-panel"
import { getActiveWorkspace } from "@/plugins/agent/lib/agent-workspace"
import { useRightPanelOpen, setRightPanel, openAiTasks, openAiSettings } from "./store"

export default function RightAiPanel() {
  const open = useRightPanelOpen()
  if (!open) return null

  return (
    <aside className="fixed inset-0 z-50 flex flex-col border-l bg-card md:static md:inset-auto md:z-auto md:w-96 md:shrink-0">
      <div className="flex h-11 shrink-0 items-center justify-between border-b px-3">
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          <Bot className="h-4 w-4 text-primary" />
          AI 助手
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => {
              const ws = getActiveWorkspace()
              if (ws) openAiTasks(ws.id, ws.name)
              else openAiSettings()
              setRightPanel(false)
            }}
            aria-label="展开为工作空间任务"
            title="展开为任务"
            className="flex h-6 w-6 items-center justify-center rounded-shell text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setRightPanel(false)}
            aria-label="关闭 AI 对话栏"
            title="关闭"
            className="flex h-6 w-6 items-center justify-center rounded-shell text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden p-3">
        <AgentPanel compact />
      </div>
    </aside>
  )
}
