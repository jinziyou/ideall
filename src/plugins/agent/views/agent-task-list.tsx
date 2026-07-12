"use client"

import * as React from "react"
import { ListTodo } from "lucide-react"
import { onFilesUpdated } from "@protocol/flowback"
import { getUiActions } from "@/lib/ui-actions"
import { Chip } from "@/ui/chip"
import { EmptyState } from "@/ui/empty-state"
import {
  getServerWorkspacesState,
  getWorkspacesState,
  subscribeWorkspaces,
} from "../lib/agent-workspace"
import { listThreads } from "../lib/agent-store"
import {
  getServerTasks,
  getTasks,
  subscribeTasks,
  TASK_STATUS_META,
  type AgentTask,
  type TaskStatus,
} from "../lib/agent-tasks"
import type { AgentThread } from "../lib/model"
import type { AgentWorkspace } from "../lib/agent-workspace"
import { AiPage, ListRow } from "./ui-kit"

export interface AgentTaskListItem {
  id: string
  workspaceId: string
  workspaceName: string
  workspaceAvailable: boolean
  title: string
  status: TaskStatus
  updatedAt: number
}

/** 将轻量任务索引与工作空间、线程正文安全地合并为列表行。 */
export function buildAgentTaskListItems(
  tasks: readonly AgentTask[],
  workspaces: readonly Pick<AgentWorkspace, "id" | "name">[],
  threads: readonly Pick<AgentThread, "id" | "title">[],
): AgentTaskListItem[] {
  const workspacesById = new Map(workspaces.map((workspace) => [workspace.id, workspace]))
  const threadsById = new Map(threads.map((thread) => [thread.id, thread]))

  return [...tasks]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map((task) => {
      const workspace = workspacesById.get(task.workspaceId)
      const thread = threadsById.get(task.id)
      return {
        id: task.id,
        workspaceId: task.workspaceId,
        workspaceName: workspace?.name ?? "空间已删除",
        workspaceAvailable: Boolean(workspace),
        title: thread ? thread.title.trim() || "未命名任务" : "对话不可用",
        status: task.status,
        updatedAt: task.updatedAt,
      }
    })
}

const STATUS_TONE: Record<TaskStatus, "idle" | "warn" | "ok" | "error"> = {
  active: "idle",
  running: "warn",
  done: "ok",
  failed: "error",
}

export default function AgentTaskList() {
  const workspaceState = React.useSyncExternalStore(
    subscribeWorkspaces,
    getWorkspacesState,
    getServerWorkspacesState,
  )
  const tasks = React.useSyncExternalStore(subscribeTasks, getTasks, getServerTasks)
  const [threads, setThreads] = React.useState<AgentThread[]>([])
  const [loaded, setLoaded] = React.useState(false)
  const refreshSequence = React.useRef(0)

  const refreshThreads = React.useCallback(async () => {
    const sequence = ++refreshSequence.current
    try {
      const next = await listThreads()
      if (sequence === refreshSequence.current) setThreads(next)
    } catch {
      // 保留上次成功快照；任务元数据仍可降级展示。
    } finally {
      if (sequence === refreshSequence.current) setLoaded(true)
    }
  }, [])

  React.useEffect(() => {
    void refreshThreads()
  }, [refreshThreads, tasks])

  React.useEffect(
    () =>
      onFilesUpdated((detail) => {
        if (!detail?.kind || detail.kind === "thread") void refreshThreads()
      }),
    [refreshThreads],
  )

  const items = React.useMemo(
    () => buildAgentTaskListItems(tasks, workspaceState.workspaces, threads),
    [tasks, workspaceState.workspaces, threads],
  )
  const workspacesById = React.useMemo(
    () => new Map(workspaceState.workspaces.map((workspace) => [workspace.id, workspace])),
    [workspaceState.workspaces],
  )

  return (
    <AiPage title="任务" icon={ListTodo}>
      {tasks.length === 0 ? (
        <EmptyState
          icon={ListTodo}
          title="还没有任务"
          description="进入一个空间并开始对话后，任务会汇总在这里。"
          variant="halo"
          bordered={false}
        />
      ) : !loaded ? (
        <p className="py-12 text-center text-sm text-muted-foreground">正在读取任务…</p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => {
            const workspace = workspacesById.get(item.workspaceId)
            const status = TASK_STATUS_META[item.status] ?? TASK_STATUS_META.active
            return (
              <ListRow
                key={item.id}
                leading={<span className={`h-2 w-2 rounded-full ${status.dot}`} />}
                title={item.title}
                subtitle={`所属空间：${item.workspaceName}`}
                onClick={
                  workspace
                    ? () => getUiActions()?.openAiTasks?.(workspace.id, workspace.name)
                    : undefined
                }
                trailing={<Chip tone={STATUS_TONE[item.status] ?? "idle"}>{status.label}</Chip>}
              />
            )
          })}
        </div>
      )}
    </AiPage>
  )
}
