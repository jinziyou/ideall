import {
  isLocalDataRecord,
  jsonArrayIssues,
  jsonObjectIssues,
  repairJsonArray,
  repairJsonObject,
  type LocalDataSchema,
  type LocalDataSchemaRepairPatch,
} from "@/plugins/shared/local-data-schema"
import { ACP_SETTINGS_STORAGE_KEY } from "./lib/acp/acp-settings"
import { AGENT_MCP_STORAGE_KEY } from "./lib/agent-mcp-registry"
import { AGENT_RULES_STORAGE_KEY } from "./lib/agent-rules"
import { AGENT_SECRETS_STORAGE_KEY } from "./lib/agent-secrets"
import { AGENT_SETTINGS_STORAGE_KEY } from "./lib/agent-settings"
import { AGENT_SKILLS_STORAGE_KEY } from "./lib/agent-skills"
import { AGENT_TASKS_STORAGE_KEY } from "./lib/agent-tasks"
import { AGENT_WORKSPACES_STORAGE_KEY } from "./lib/agent-workspace"

function agentSettingsIssues(value: unknown): string[] {
  if (!isLocalDataRecord(value)) return ["应为 JSON 对象"]
  return typeof value.apiKey === "string" && value.apiKey.trim() ? ["仍包含旧版明文 API Key"] : []
}

function repairAgentSettings(value: unknown): LocalDataSchemaRepairPatch {
  if (!isLocalDataRecord(value)) {
    return { action: "write", value: {}, detail: "已重置为空设置对象" }
  }
  const next = { ...value }
  delete next.apiKey
  return { action: "write", value: next, detail: "已移除旧版明文 API Key 字段" }
}

function agentSecretsIssues(value: unknown): string[] {
  if (!Array.isArray(value)) return ["应为 JSON 数组"]
  const localValues = value.filter(
    (item) => isLocalDataRecord(item) && typeof item.value === "string" && item.value.trim(),
  ).length
  return localValues ? [`${localValues} 个密钥仍含明文 value`] : []
}

function repairAgentSecrets(value: unknown): LocalDataSchemaRepairPatch {
  if (!Array.isArray(value)) {
    return { action: "write", value: [], detail: "已重置为空密钥索引" }
  }
  const next = value
    .filter(
      (item): item is Record<string, unknown> =>
        isLocalDataRecord(item) && typeof item.id === "string",
    )
    .map((item) => ({ ...item, value: "", secure: true }))
  return { action: "write", value: next, detail: "已清理密钥索引中的明文 value" }
}

function agentWorkspacesIssues(value: unknown): string[] {
  if (!isLocalDataRecord(value)) return ["应为 JSON 对象"]
  const workspaces = Array.isArray(value.workspaces) ? value.workspaces : []
  const localKeys = workspaces.filter((workspace) => {
    if (!isLocalDataRecord(workspace) || !isLocalDataRecord(workspace.model)) return false
    return typeof workspace.model.apiKey === "string" && workspace.model.apiKey.trim()
  }).length
  return localKeys ? [`${localKeys} 个工作区模型覆盖仍含明文 API Key`] : []
}

function repairAgentWorkspaces(value: unknown): LocalDataSchemaRepairPatch {
  if (!isLocalDataRecord(value)) {
    return { action: "write", value: { workspaces: [] }, detail: "已重置工作区配置" }
  }
  const workspaces = Array.isArray(value.workspaces) ? value.workspaces : []
  return {
    action: "write",
    value: {
      ...value,
      workspaces: workspaces.map((workspace) => {
        if (!isLocalDataRecord(workspace) || !isLocalDataRecord(workspace.model)) return workspace
        const model = { ...workspace.model }
        delete model.apiKey
        return { ...workspace, model }
      }),
    },
    detail: "已移除工作区模型覆盖中的明文 API Key",
  }
}

export const agentLocalDataSchemas: readonly LocalDataSchema[] = [
  {
    id: "agent.settings",
    label: "AI 智能体全局设置",
    owner: "agent",
    storage: "localStorage",
    key: AGENT_SETTINGS_STORAGE_KEY,
    currentVersion: 1,
    sensitive: true,
    portable: true,
    parseAs: "json",
    validate: agentSettingsIssues,
    repair: repairAgentSettings,
  },
  {
    id: "agent.mcp",
    label: "MCP 服务器注册表",
    owner: "agent",
    storage: "localStorage",
    key: AGENT_MCP_STORAGE_KEY,
    currentVersion: 1,
    portable: true,
    parseAs: "json",
    validate: jsonArrayIssues,
    repair: repairJsonArray,
  },
  {
    id: "agent.rules",
    label: "AI 规则注册表",
    owner: "agent",
    storage: "localStorage",
    key: AGENT_RULES_STORAGE_KEY,
    currentVersion: 1,
    portable: true,
    parseAs: "json",
    validate: jsonArrayIssues,
    repair: repairJsonArray,
  },
  {
    id: "agent.skills",
    label: "AI 技能注册表",
    owner: "agent",
    storage: "localStorage",
    key: AGENT_SKILLS_STORAGE_KEY,
    currentVersion: 1,
    portable: true,
    parseAs: "json",
    validate: jsonArrayIssues,
    repair: repairJsonArray,
  },
  {
    id: "agent.tasks",
    label: "AI 任务索引",
    owner: "agent",
    storage: "localStorage",
    key: AGENT_TASKS_STORAGE_KEY,
    currentVersion: 1,
    portable: true,
    parseAs: "json",
    validate: jsonArrayIssues,
    repair: repairJsonArray,
  },
  {
    id: "agent.workspaces",
    label: "AI 工作区配置",
    owner: "agent",
    storage: "localStorage",
    key: AGENT_WORKSPACES_STORAGE_KEY,
    currentVersion: 1,
    sensitive: true,
    portable: true,
    parseAs: "json",
    validate: agentWorkspacesIssues,
    repair: repairAgentWorkspaces,
  },
  {
    id: "agent.secrets",
    label: "MCP 密钥索引",
    owner: "agent",
    storage: "localStorage",
    key: AGENT_SECRETS_STORAGE_KEY,
    currentVersion: 1,
    sensitive: true,
    portable: true,
    parseAs: "json",
    validate: agentSecretsIssues,
    repair: repairAgentSecrets,
  },
  {
    id: "agent.acp",
    label: "ACP 接入设置",
    owner: "agent",
    storage: "localStorage",
    key: ACP_SETTINGS_STORAGE_KEY,
    currentVersion: 1,
    parseAs: "json",
    validate: jsonObjectIssues,
    repair: repairJsonObject,
  },
]
