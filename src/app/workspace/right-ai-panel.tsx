"use client"

// 右侧 AI 对话栏 (AI 原生): 桌面右停靠列, 移动端全屏覆盖。承载 AgentPanel (紧凑模式)。
import { Bot, X } from "lucide-react"
import AgentPanel from "@/components/plugins/agent/views/agent-panel"
import { useRightPanelOpen, setRightPanel } from "./store"

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
      <div className="min-h-0 flex-1 overflow-hidden p-3">
        <AgentPanel compact />
      </div>
    </aside>
  )
}
