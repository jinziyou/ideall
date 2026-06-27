"use client"

// AI 智能体工作区 (左侧活动栏 AI 钮打开的全幅标签, layout:"fill")。
// 左 = [组合]上下文组合器 / [精确]精确模式; 右 = 复用的 AgentPanel 对话面,
// 经 resolveRun 注入「当前工作区」组合上下文 (精确模式可原样覆盖)。头部 = 工作区切换 + 新建/删除。

import * as React from "react"
import { Bot, Plus, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select"
import AgentPanel, { type ResolvedRun } from "./agent-panel"
import ExternalAgentPanel from "./external-agent-panel"
import ContextComposer from "./context-composer"
import PrecisePrompt from "./precise-prompt"
import { BUILTIN_SKILLS } from "../lib/agent-skills"
import {
  getAcpServerStatus,
  getAcpServerStatusServer,
  subscribeAcpServerStatus,
} from "../lib/acp-status"
import type { ConnectAgentOpts } from "../lib/agent-mcp"
import {
  assembleSystemPrompt,
  buildWorkspaceSegments,
  gatherHomeContext,
  gatherReferencedContext,
} from "../lib/agent-context"
import {
  createWorkspace,
  deleteWorkspace,
  getActiveWorkspace,
  getServerWorkspacesState,
  getWorkspacesState,
  homeSelectionOf,
  isWorkspaceConfigured,
  resolveModel,
  setActiveWorkspaceId,
  subscribeWorkspaces,
} from "../lib/agent-workspace"

export default function AiWorkspace() {
  const wsState = React.useSyncExternalStore(
    subscribeWorkspaces,
    getWorkspacesState,
    getServerWorkspacesState,
  )
  const ws =
    wsState.workspaces.find((w) => w.id === wsState.activeId) ?? wsState.workspaces[0] ?? null
  const [leftTab, setLeftTab] = React.useState<"compose" | "precise">("compose")
  const [chatMode, setChatMode] = React.useState<"local" | "external">("local")
  const acpStatus = React.useSyncExternalStore(
    subscribeAcpServerStatus,
    getAcpServerStatus,
    getAcpServerStatusServer,
  )
  const acpLabel = acpStatus.listening
    ? acpStatus.connections > 0
      ? `编辑器已接入 ${acpStatus.connections}`
      : `监听 :${acpStatus.port}`
    : "未接入"

  // resolveRun 在「发送时」读最新工作区 (getActiveWorkspace), 这样组合器 / 精确模式里的改动即时生效。
  const resolveRun = React.useCallback(async (useAgent: boolean): Promise<ResolvedRun | null> => {
    const w = getActiveWorkspace()
    if (!w) return null
    const m = resolveModel(w)
    if (!m.apiKey.trim() || !m.baseURL.trim() || !m.model.trim()) return null
    const mcp: ConnectAgentOpts = {
      permissions: w.capabilities.permissions,
      toolAllowlist: w.capabilities.toolAllowlist,
    }

    // 精确模式「原样发送」: 直接用用户编辑后的最终提示 (冻结快照, 不再取数)。
    if (w.prompt.precise && w.prompt.override.trim()) {
      return { ...m, system: w.prompt.override, mcp }
    }

    const sel = homeSelectionOf(w)
    let homeContext = ""
    let referenced = ""
    if (sel) {
      try {
        homeContext = await gatherHomeContext(sel)
      } catch {
        /* 取数失败时降级为空上下文 */
      }
      try {
        referenced = await gatherReferencedContext()
      } catch {
        /* 忽略 */
      }
    }
    const system = assembleSystemPrompt(
      buildWorkspaceSegments({
        tools: useAgent,
        homeContext,
        referenced,
        instructions: w.prompt.instructions,
        rules: w.rules.rules,
        examples: w.rules.examples,
      }),
      w.prompt.template,
    )
    return { ...m, system, mcp }
  }, [])

  if (!ws) {
    return <div className="p-6 text-sm text-muted-foreground">正在初始化工作区…</div>
  }

  const skillIds = ws.capabilities.skillIds
  const skills = skillIds ? BUILTIN_SKILLS.filter((s) => skillIds.includes(s.id)) : BUILTIN_SKILLS
  const configured = isWorkspaceConfigured(ws)
  const modelLabel = ws.model.useGlobal
    ? `${resolveModel(ws).model}（全局）`
    : resolveModel(ws).model

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <Bot className="h-4 w-4 shrink-0 text-primary" />
        <span className="shrink-0 text-sm font-semibold">AI 工作区</span>
        <Select value={ws.id} onValueChange={setActiveWorkspaceId}>
          <SelectTrigger className="h-7 w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {wsState.workspaces.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1"
          title="新建工作区"
          onClick={() => createWorkspace()}
        >
          <Plus className="h-4 w-4" />
          新建
        </Button>
        <span
          className="ml-auto hidden items-center text-xs text-muted-foreground sm:flex"
          title="能力经进程内 loopback MCP; ACP 暴露经设置开启 (编辑器经 loopback 连入)"
        >
          本地 MCP · ACP {acpLabel}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="删除当前工作区"
          disabled={wsState.workspaces.length <= 1}
          onClick={() => deleteWorkspace(ws.id)}
        >
          <Trash2 className="h-4 w-4" />
          <span className="sr-only">删除工作区</span>
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside className="flex max-h-72 shrink-0 flex-col overflow-hidden border-b md:max-h-none md:w-80 md:border-b-0 md:border-r">
          <div className="flex h-9 shrink-0 items-center gap-1 border-b px-2">
            {(["compose", "precise"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setLeftTab(t)}
                className={cn(
                  "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                  leftTab === t
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/60",
                )}
              >
                {t === "compose" ? "组合" : "精确"}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {leftTab === "compose" ? <ContextComposer ws={ws} /> : <PrecisePrompt ws={ws} />}
          </div>
        </aside>
        <div className="flex min-h-0 flex-1 flex-col p-4">
          <div className="mb-2 flex shrink-0 items-center gap-1">
            {(["local", "external"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setChatMode(mode)}
                className={cn(
                  "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                  chatMode === mode
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/60",
                )}
              >
                {mode === "local" ? "本机模型" : "外部智能体"}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1">
            {chatMode === "local" ? (
              <AgentPanel
                resolveRun={resolveRun}
                configured={configured}
                modelLabel={modelLabel}
                skills={skills}
              />
            ) : (
              <ExternalAgentPanel />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
