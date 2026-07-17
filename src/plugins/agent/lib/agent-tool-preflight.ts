import { isNodeKind } from "@protocol/node"
import type { Permission } from "@/plugins/embed/protocol"
import { TOOL } from "@/plugins/embed/protocol"
import { resourceFileRef } from "@/filesystem/resource-file-system"
import { fileSystemRegistry, type FileSystemRegistry } from "@/filesystem/registry"
import type { AgentToolPreview } from "./agent-tool-preview"

export type PreparedAgentToolCall = Readonly<{
  args: Record<string, unknown>
  preview: AgentToolPreview
}>

export type AgentToolPreflightGateway = Pick<FileSystemRegistry, "stat">

const VERSION_BOUND_TOOLS = new Set<string>([TOOL.fsWrite, TOOL.fsMove, TOOL.fsDelete])

export class AgentToolPreflightError extends Error {
  override name = "AgentToolPreflightError"
}

/**
 * 在用户看到审批条之前读取真实 File metadata，并用该快照的 provider version
 * 覆盖模型参数中任何伪造值。实际执行会把此 version 贯穿到 Storage CAS。
 */
export async function prepareLocalAgentToolCall(
  name: string,
  args: Record<string, unknown>,
  preview: AgentToolPreview,
  permissions: readonly Permission[],
  gateway: AgentToolPreflightGateway = fileSystemRegistry,
): Promise<PreparedAgentToolCall> {
  if (!VERSION_BOUND_TOOLS.has(name)) return { args, preview }

  const nextArgs = { ...args }
  delete nextArgs.expectedVersion
  if (
    typeof args.kind !== "string" ||
    !isNodeKind(args.kind) ||
    typeof args.id !== "string" ||
    !args.id.trim()
  ) {
    throw new AgentToolPreflightError("工具目标身份无效")
  }

  const ref = resourceFileRef({ scheme: "node", kind: args.kind, id: args.id })
  const file = await gateway.stat(ref, {
    actor: "agent",
    permissions: [...permissions],
    intent: "metadata",
  })
  if (!file) throw new AgentToolPreflightError("目标不存在或已删除")
  if (!file.version) throw new AgentToolPreflightError("目标不支持版本绑定写入")

  nextArgs.expectedVersion = file.version
  return {
    args: nextArgs,
    preview: {
      ...preview,
      target: {
        kind: args.kind,
        id: args.id,
        label: file.name,
      },
      fields: [...preview.fields, { label: "确认版本", value: file.version }],
    },
  }
}
