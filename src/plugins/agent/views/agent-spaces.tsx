"use client"

import { Boxes, ChevronRight } from "lucide-react"
import type { FileRef } from "@protocol/file-system"
import { AGENT_WORKSPACES_FILE_REF } from "@/filesystem/builtin-app-roots"
import { getUiActions } from "@/lib/ui-actions"
import { useFileDocument } from "@/shared/use-file-document"
import { Chip } from "@/ui/chip"
import { EmptyState } from "@/ui/empty-state"
import {
  AGENT_WORKSPACE_CREATE_ACTION,
  decodeAgentWorkspaceCreateResult,
  decodeAgentWorkspacesDocument,
} from "../agent-management-file-contract"
import { AddButton, AiPage, ListRow } from "./ui-kit"

function openSpace(workspaceId: string, name: string): void {
  getUiActions()?.openAiTasks?.(workspaceId, name)
}

export default function AgentSpaces({
  fileRef = AGENT_WORKSPACES_FILE_REF,
}: {
  fileRef?: FileRef
}) {
  const workspacesDocument = useFileDocument(fileRef, decodeAgentWorkspacesDocument)
  const state = workspacesDocument.data

  async function createSpace() {
    if (workspacesDocument.acting) return
    try {
      const result = decodeAgentWorkspaceCreateResult(
        await workspacesDocument.invoke(AGENT_WORKSPACE_CREATE_ACTION),
      )
      openSpace(result.workspaceId, result.name)
    } catch {
      // useFileDocument 已保留结构化错误，页面内统一展示。
    }
  }

  const action = (
    <AddButton
      label={workspacesDocument.acting ? "正在创建…" : "新建空间"}
      onClick={() => void createSpace()}
    />
  )

  return (
    <AiPage title="空间" icon={Boxes} action={action}>
      {workspacesDocument.loading && !state ? (
        <p className="py-12 text-center text-sm text-muted-foreground">正在读取空间…</p>
      ) : workspacesDocument.error && !state ? (
        <EmptyState
          icon={Boxes}
          title="空间读取失败"
          description="文件系统暂不可用，请稍后重试。"
          variant="halo"
          bordered={false}
        />
      ) : !state || state.workspaces.length === 0 ? (
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
            const count = workspace.taskCount
            return (
              <ListRow
                key={workspace.id}
                leading={<Boxes className="h-4 w-4 text-muted-foreground" />}
                title={workspace.name}
                subtitle={count === 0 ? "还没有任务" : `${count} 个任务`}
                onClick={() => openSpace(workspace.id, workspace.name)}
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
