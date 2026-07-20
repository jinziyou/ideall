import type { FileRef } from "@protocol/file-system"
import { AGENT_WORKSPACES_FILE_REF } from "@/filesystem/builtin-app-roots"
import { invokeFileAction } from "@/filesystem/registry"
import type { FileSystemAccessContext } from "@/filesystem/types"
import {
  AGENT_WORKSPACE_ACTIVATE_ACTION,
  type AgentWorkspaceActivateInput,
} from "@/plugins/agent/agent-management-file-contract"

const UI_ACTION_CONTEXT = {
  actor: "ui",
  permissions: [],
  intent: "action",
} as const satisfies FileSystemAccessContext

export type AgentWorkspaceActionInvoker = (
  ref: FileRef,
  action: string,
  input: unknown,
  ctx: FileSystemAccessContext,
) => Promise<unknown>

/** 激活失败不阻断显式导航；但成功路径必须先提交文件动作，再打开对应任务页。 */
export async function activateAgentWorkspaceBeforeOpen(
  workspaceId: string,
  open: () => void,
  invoke: AgentWorkspaceActionInvoker = invokeFileAction,
): Promise<void> {
  const input: AgentWorkspaceActivateInput = { workspaceId }
  try {
    await invoke(
      AGENT_WORKSPACES_FILE_REF,
      AGENT_WORKSPACE_ACTIVATE_ACTION,
      input,
      UI_ACTION_CONTEXT,
    )
  } catch {
    // 与旧 setActiveWorkspace 的无效 id/no-op 行为一致：目标页仍可展示“不存在”降级态。
  }
  open()
}
