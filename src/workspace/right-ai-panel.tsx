"use client"

// 右侧 AI 对话栏 (AI 原生): 宽屏 (lg+) 右停靠列, 移动端与平板 (<lg) 全屏覆盖。
import * as React from "react"
import { Bot, Maximize2, Plus, Settings, X } from "lucide-react"
import AgentPanel, { type AgentPanelHandle } from "@/plugins/agent/views/agent-panel"
import { getActiveWorkspace } from "@/plugins/agent/lib/agent-workspace"
import {
  getAgentSettings,
  isConfigured,
  subscribeAgentSettings,
} from "@/plugins/agent/lib/agent-settings"
import { SurfacePanel } from "@/plugins/agent/views/ui-kit"
import { IconButton } from "@/ui/icon-button"
import { useRightPanelOpen, setRightPanel, openAiTasks, openAiSettings } from "./store"

export default function RightAiPanel() {
  const open = useRightPanelOpen()
  const panelRef = React.useRef<AgentPanelHandle>(null)
  const settings = React.useSyncExternalStore(
    subscribeAgentSettings,
    getAgentSettings,
    getAgentSettings,
  )
  const configured = isConfigured(settings)

  if (!open) return null

  return (
    <aside className="fixed inset-0 z-50 flex flex-col bg-muted/25 p-3 lg:static lg:inset-auto lg:z-auto lg:w-[25rem] lg:shrink-0 lg:border-l lg:p-4">
      <SurfacePanel>
        <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-lg border bg-background">
              <Bot className="h-4 w-4 text-muted-foreground" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold leading-tight">AI 助手</span>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {configured ? settings.model : "未配置模型"}
              </span>
            </span>
          </span>
          <div className="flex items-center gap-0.5">
            <IconButton
              onClick={() => panelRef.current?.newChat()}
              aria-label="新对话"
              title="新对话"
            >
              <Plus className="h-4 w-4" />
            </IconButton>
            <IconButton
              onClick={() => {
                const ws = getActiveWorkspace()
                if (ws) openAiTasks(ws.id, ws.name)
                else openAiSettings()
                setRightPanel(false)
              }}
              aria-label="展开为工作区任务"
              title="展开为任务"
            >
              <Maximize2 className="h-4 w-4" />
            </IconButton>
            <IconButton onClick={() => openAiSettings()} aria-label="AI 设置" title="设置">
              <Settings className="h-4 w-4" />
            </IconButton>
            <IconButton
              onClick={() => setRightPanel(false)}
              aria-label="关闭 AI 对话栏"
              title="关闭"
            >
              <X className="h-4 w-4" />
            </IconButton>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <AgentPanel ref={panelRef} compact />
        </div>
      </SurfacePanel>
    </aside>
  )
}
