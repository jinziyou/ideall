import { AGENT_AUDIT_FILE_REF } from "@/filesystem/builtin-app-roots"
import { invokeFileAction } from "@/filesystem/registry"
import {
  AGENT_AUDIT_APPEND_ACTION,
  AGENT_AUDIT_COMPLETE_ACTION,
  AGENT_AUDIT_WRITE_PERMISSION,
} from "../agent-audit-file-contract"
import { type AgentWriteAuditCompletion, type AgentWriteAuditInput } from "./agent-write-audit"

const AGENT_AUDIT_CONTEXT = {
  actor: "agent",
  permissions: [AGENT_AUDIT_WRITE_PERMISSION],
  intent: "action",
} as const

function receiptId(value: unknown): string {
  const id = value && typeof value === "object" ? (value as { id?: unknown }).id : null
  if (typeof id !== "string" || !id) {
    throw new Error("Agent audit provider returned an invalid receipt")
  }
  return id
}

export async function appendAgentWriteAuditViaFileSystem(
  input: AgentWriteAuditInput,
): Promise<string> {
  return receiptId(
    await invokeFileAction(
      AGENT_AUDIT_FILE_REF,
      AGENT_AUDIT_APPEND_ACTION,
      input,
      AGENT_AUDIT_CONTEXT,
    ),
  )
}

export async function completeAgentWriteAuditViaFileSystem(
  completion: AgentWriteAuditCompletion,
): Promise<void> {
  await invokeFileAction(
    AGENT_AUDIT_FILE_REF,
    AGENT_AUDIT_COMPLETE_ACTION,
    completion,
    AGENT_AUDIT_CONTEXT,
  )
}
