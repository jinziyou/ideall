import * as React from "react"
import type { EngineDescriptor } from "@protocol/engine"
import { sameFileRef, type FileRef, type IdeallFile } from "@protocol/file-system"
import {
  AGENT_AUDIT_FILE_REF,
  AGENT_AUDIT_MEDIA_TYPE,
  AGENT_SETTINGS_FILE_REF,
  AGENT_SETTINGS_MEDIA_TYPE,
  AGENT_TASKS_FILE_REF,
  AGENT_TASKS_MEDIA_TYPE,
  AGENT_WORKSPACES_FILE_REF,
  AGENT_WORKSPACES_MEDIA_TYPE,
} from "@/filesystem/builtin-app-roots"

export type AgentFileEngineRenderer = (
  context: Readonly<{
    file: IdeallFile
    descriptor: EngineDescriptor
  }>,
) => React.ReactNode

export type AgentEngineContribution = Readonly<{
  descriptor: EngineDescriptor
  renderer: AgentFileEngineRenderer
}>

type AgentManagementDisplayProps = Readonly<{ fileRef: FileRef }>

const AiSettings = React.lazy(() => import("./views/ai-settings"))
const AgentSpaces = React.lazy(() => import("./views/agent-spaces"))
const AgentTaskList = React.lazy(() => import("./views/agent-task-list"))
const AgentWriteAudit = React.lazy(() => import("./views/agent-write-audit"))

function exactFileRenderer(
  expected: FileRef,
  Display: React.ComponentType<AgentManagementDisplayProps>,
): AgentFileEngineRenderer {
  return function AgentManagementFileRenderer({ file, descriptor }) {
    return sameFileRef(file.ref, expected) ? (
      <Display fileRef={file.ref} />
    ) : (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        {descriptor.label}尚未接入 {file.source.label ?? file.source.id} 的此类文件。
      </div>
    )
  }
}

export const agentSettingsEngineDescriptor = {
  engineId: "ideall.agent-settings",
  label: "AI 设置",
  match: {
    kinds: ["file"],
    mediaTypes: [AGENT_SETTINGS_MEDIA_TYPE],
    properties: { agentManagementSurface: "settings" },
  },
  priority: 940,
  layout: "fill",
  access: "read-write",
  supportsStandaloneWindow: false,
  iconHint: "bot",
} as const satisfies EngineDescriptor

export const agentSpacesEngineDescriptor = {
  engineId: "ideall.agent-spaces",
  label: "空间",
  match: {
    kinds: ["file"],
    mediaTypes: [AGENT_WORKSPACES_MEDIA_TYPE],
    properties: { agentManagementSurface: "spaces" },
  },
  priority: 940,
  layout: "padded",
  access: "read-write",
  supportsStandaloneWindow: false,
  iconHint: "boxes",
} as const satisfies EngineDescriptor

export const agentTasksEngineDescriptor = {
  engineId: "ideall.agent-tasks",
  label: "任务",
  match: {
    kinds: ["file"],
    mediaTypes: [AGENT_TASKS_MEDIA_TYPE],
    properties: { agentManagementSurface: "tasks" },
  },
  priority: 940,
  layout: "padded",
  access: "read-write",
  supportsStandaloneWindow: false,
  iconHint: "sparkles",
} as const satisfies EngineDescriptor

export const agentAuditEngineDescriptor = {
  engineId: "ideall.agent-write-audit",
  label: "AI 写入审计",
  match: {
    kinds: ["file"],
    mediaTypes: [AGENT_AUDIT_MEDIA_TYPE],
    properties: { agentManagementSurface: "audit" },
  },
  priority: 940,
  layout: "padded",
  access: "read-only",
  supportsStandaloneWindow: false,
  iconHint: "shield-check",
} as const satisfies EngineDescriptor

export const agentSettingsEngineContribution = {
  descriptor: agentSettingsEngineDescriptor,
  renderer: exactFileRenderer(AGENT_SETTINGS_FILE_REF, AiSettings),
} as const satisfies AgentEngineContribution

export const agentSpacesEngineContribution = {
  descriptor: agentSpacesEngineDescriptor,
  renderer: exactFileRenderer(AGENT_WORKSPACES_FILE_REF, AgentSpaces),
} as const satisfies AgentEngineContribution

export const agentTasksEngineContribution = {
  descriptor: agentTasksEngineDescriptor,
  renderer: exactFileRenderer(AGENT_TASKS_FILE_REF, AgentTaskList),
} as const satisfies AgentEngineContribution

export const agentAuditEngineContribution = {
  descriptor: agentAuditEngineDescriptor,
  renderer: exactFileRenderer(AGENT_AUDIT_FILE_REF, AgentWriteAudit),
} as const satisfies AgentEngineContribution

export const agentManagementEngineContributions = [
  agentSettingsEngineContribution,
  agentSpacesEngineContribution,
  agentTasksEngineContribution,
  agentAuditEngineContribution,
] as const satisfies readonly AgentEngineContribution[]
