"use client"

// 工作空间「任务」标签 (kind:"ai-tasks", params.workspaceId)。点活动栏侧栏的工作空间名打开。
// 顶部子切换: 任务(运行面) | 配置(定义面)。
//   任务 = 复用 AgentPanel, 经 scopeIds 限定到本工作空间的任务线程, resolveRun 注入本工作空间上下文;
//          其线程侧栏即「任务列表」, 新建/恢复/删除即任务操作 (首发消息建线程 → attachTask 登记)。
//   配置 = 组合器 (数据/能力/规则/提示词/模型) | 精确模式 —— 即旧 ai-workspace 左栏, 现归入此处。

import * as React from "react"
import { Boxes, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/ui/button"
import { getUiActions } from "@/lib/ui-actions"
import AgentPanel from "./agent-panel"
import ContextComposer from "./context-composer"
import PrecisePrompt from "./precise-prompt"
import { EmptyState } from "@/ui/empty-state"
import { resolveWorkspaceRun } from "../lib/agent-resolve"
import { resolveSkills } from "../lib/agent-skills"
import {
  deleteWorkspace,
  getServerWorkspacesState,
  getWorkspace,
  getWorkspacesState,
  isWorkspaceConfigured,
  renameWorkspace,
  resolveModel,
  subscribeWorkspaces,
} from "../lib/agent-workspace"
import { attachTask, getServerTasks, getTasks, subscribeTasks } from "../lib/agent-tasks"

export default function AiTasks({ workspaceId }: { workspaceId: string }) {
  const wsState = React.useSyncExternalStore(
    subscribeWorkspaces,
    getWorkspacesState,
    getServerWorkspacesState,
  )
  const tasks = React.useSyncExternalStore(subscribeTasks, getTasks, getServerTasks)
  const ws = wsState.workspaces.find((w) => w.id === workspaceId) ?? null

  const [view, setView] = React.useState<"tasks" | "config">("tasks")
  const [configView, setConfigView] = React.useState<"compose" | "precise">("compose")

  // 发送时读最新工作空间 (组合器改动即时生效)。
  const resolveRun = React.useCallback(
    async (useAgent: boolean) => {
      const w = getWorkspace(workspaceId)
      return w ? resolveWorkspaceRun(w, useAgent) : null
    },
    [workspaceId],
  )

  if (!ws) {
    return (
      <div className="grid h-full place-items-center p-6">
        <EmptyState icon={Boxes} title="工作空间不存在" variant="halo" bordered={false} />
      </div>
    )
  }

  const scopeIds = tasks.filter((t) => t.workspaceId === workspaceId).map((t) => t.id)
  const skills = resolveSkills(ws.capabilities.skillIds)
  const configured = isWorkspaceConfigured(ws)
  const modelLabel = ws.model.useGlobal
    ? `${resolveModel(ws).model}（全局）`
    : resolveModel(ws).model

  function onDelete() {
    if (wsState.workspaces.length <= 1) return
    deleteWorkspace(workspaceId)
    getUiActions()?.closeAiTasks?.(workspaceId)
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-6">
        <Boxes className="h-[1.1rem] w-[1.1rem] shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <input
            defaultValue={ws.name}
            onBlur={(e) => renameWorkspace(workspaceId, e.target.value)}
            aria-label="工作空间名称"
            className="w-full max-w-xs truncate bg-transparent text-[15px] font-semibold leading-tight outline-none focus:rounded focus:bg-accent/60 focus:px-1"
          />
          <p className="truncate text-[13px] text-muted-foreground">
            {configured ? `就绪 · ${modelLabel}` : "未配置模型 · 见「配置 · 模型」"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1 rounded-md border p-0.5">
          {(["tasks", "config"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={cn(
                "rounded px-3 py-1 text-sm font-medium transition-colors",
                view === v
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v === "tasks" ? "任务" : "配置"}
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          title="删除工作空间"
          disabled={wsState.workspaces.length <= 1}
          onClick={onDelete}
        >
          <Trash2 className="h-4 w-4" />
          <span className="sr-only">删除工作空间</span>
        </Button>
      </header>

      <div className="min-h-0 flex-1">
        {view === "tasks" ? (
          <div className="h-full px-6 py-5">
            <AgentPanel
              resolveRun={resolveRun}
              configured={configured}
              modelLabel={modelLabel}
              skills={skills}
              scopeIds={scopeIds}
              onThreadCreated={(id) => attachTask(workspaceId, id)}
              onOpenSettings={() => setView("config")}
              newLabel="新任务"
              emptyLabel="还没有任务"
            />
          </div>
        ) : (
          <div className="flex h-full flex-col">
            <div className="flex h-9 shrink-0 items-center gap-1 border-b px-3">
              {(["compose", "precise"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setConfigView(v)}
                  className={cn(
                    "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                    configView === v
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/60",
                  )}
                >
                  {v === "compose" ? "组合" : "精确"}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1">
              {configView === "compose" ? <ContextComposer ws={ws} /> : <PrecisePrompt ws={ws} />}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
