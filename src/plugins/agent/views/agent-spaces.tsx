"use client"

import * as React from "react"
import { Boxes, ChevronRight } from "lucide-react"
import { getUiActions } from "@/lib/ui-actions"
import { Chip } from "@/ui/chip"
import { EmptyState } from "@/ui/empty-state"
import {
  createWorkspace,
  getServerWorkspacesState,
  getWorkspacesState,
  subscribeWorkspaces,
  type AgentWorkspace,
} from "../lib/agent-workspace"
import { getServerTasks, getTasks, subscribeTasks } from "../lib/agent-tasks"
import { AddButton, AiPage, ListRow } from "./ui-kit"

function openSpace(workspace: Pick<AgentWorkspace, "id" | "name">): void {
  getUiActions()?.openAiTasks?.(workspace.id, workspace.name)
}

export default function AgentSpaces() {
  const state = React.useSyncExternalStore(
    subscribeWorkspaces,
    getWorkspacesState,
    getServerWorkspacesState,
  )
  const tasks = React.useSyncExternalStore(subscribeTasks, getTasks, getServerTasks)
  const taskCounts = React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const task of tasks) counts.set(task.workspaceId, (counts.get(task.workspaceId) ?? 0) + 1)
    return counts
  }, [tasks])

  function createSpace() {
    openSpace(createWorkspace())
  }

  const action = <AddButton label="新建空间" onClick={createSpace} />

  return (
    <AiPage title="空间" icon={Boxes} action={action}>
      {state.workspaces.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="还没有空间"
          description="创建一个空间来组织任务、上下文与 AI 配置。"
          variant="halo"
          bordered={false}
          action={action}
        />
      ) : (
        <div className="space-y-2">
          {state.workspaces.map((workspace) => {
            const count = taskCounts.get(workspace.id) ?? 0
            return (
              <ListRow
                key={workspace.id}
                leading={<Boxes className="h-4 w-4 text-muted-foreground" />}
                title={workspace.name}
                subtitle={count === 0 ? "还没有任务" : `${count} 个任务`}
                onClick={() => openSpace(workspace)}
                trailing={
                  <>
                    {workspace.id === state.activeId && <Chip tone="info">当前</Chip>}
                    <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  </>
                }
              />
            )
          })}
        </div>
      )}
    </AiPage>
  )
}
