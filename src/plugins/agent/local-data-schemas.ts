import {
  isLocalDataRecord,
  jsonArrayIssues,
  jsonObjectIssues,
  repairJsonArray,
  repairJsonObject,
  type LocalDataSchema,
  type LocalDataSchemaRepairPatch,
} from "@/plugins/shared/local-data-schema"
import { IDB_DATABASE_NAME, IDB_DATABASE_VERSION } from "@/lib/idb"
import { withAgentWorkspaceFileWriteLocks } from "./agent-workspace-write-adapter"
import { ACP_SETTINGS_STORAGE_KEY } from "./lib/acp/acp-settings"
import { AGENT_MCP_STORAGE_KEY } from "./lib/agent-mcp-registry"
import { AGENT_RULES_STORAGE_KEY } from "./lib/agent-rules"
import { AGENT_SECRETS_STORAGE_KEY } from "./lib/agent-secrets"
import {
  AGENT_SETTINGS_CREDENTIAL_REVISION_STORAGE_KEY,
  AGENT_SETTINGS_STORAGE_KEY,
} from "./lib/agent-settings"
import { AGENT_SKILLS_STORAGE_KEY } from "./lib/agent-skills"
import {
  AGENT_WORKSPACES_STORAGE_KEY,
  refreshAgentWorkspacesRaw,
  repairPublicWorkspacesStateRaw,
  type WorkspacesState,
} from "./lib/agent-workspace"
import { decodeAgentWorkspacesState, sanitizeWorkspaces } from "./lib/agent-config-codecs"

const AGENT_WORKSPACE_REVISION_PATTERN = /^(0|[1-9]\d{0,63})$/

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
  const issues: string[] = []
  if (
    value._revision !== undefined &&
    (typeof value._revision !== "string" || !AGENT_WORKSPACE_REVISION_PATTERN.test(value._revision))
  ) {
    issues.push("_revision 应为非负十进制单调版本")
  }

  const publicValue = { ...value }
  delete publicValue._revision
  try {
    decodeAgentWorkspacesState(publicValue, true)
  } catch {
    issues.push("公开工作区结构无效（workspaces 必须非空且 activeId 必须引用现有工作区）")
  }

  const workspaces = Array.isArray(value.workspaces) ? value.workspaces : []
  const localKeys = workspaces.filter((workspace) => {
    if (!isLocalDataRecord(workspace) || !isLocalDataRecord(workspace.model)) return false
    return typeof workspace.model.apiKey === "string" && workspace.model.apiKey.trim()
  }).length
  if (localKeys) issues.push(`${localKeys} 个工作区模型覆盖仍含明文 API Key`)
  return issues
}

function repairAgentWorkspaces(value: unknown): LocalDataSchemaRepairPatch {
  if (!isLocalDataRecord(value)) {
    return { action: "write", value: { workspaces: [] }, detail: "已重置工作区配置" }
  }
  const sanitized = sanitizeWorkspaces(value)
  const publicValue = isLocalDataRecord(sanitized) ? sanitized : { workspaces: [], activeId: "" }
  const workspaces = Array.isArray(publicValue.workspaces) ? publicValue.workspaces : []
  const seenIds = new Set<string>()
  const deduplicated = workspaces.filter((workspace) => {
    if (!isLocalDataRecord(workspace) || typeof workspace.id !== "string" || !workspace.id) {
      return true
    }
    if (seenIds.has(workspace.id)) return false
    seenIds.add(workspace.id)
    return true
  })
  const revision =
    typeof value._revision === "string" && AGENT_WORKSPACE_REVISION_PATTERN.test(value._revision)
      ? value._revision
      : undefined
  return {
    action: "write",
    value: {
      ...publicValue,
      workspaces: deduplicated,
      ...(revision === undefined ? {} : { _revision: revision }),
    },
    detail: "已规范化工作区配置并移除明文 API Key",
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
    id: "agent.settings.credential-revision",
    label: "AI 凭据变更版本",
    owner: "agent",
    storage: "localStorage",
    key: AGENT_SETTINGS_CREDENTIAL_REVISION_STORAGE_KEY,
    currentVersion: 1,
    parseAs: "text",
    validate: (_value, raw) => (/^(0|[1-9]\d{0,63})$/.test(raw) ? [] : ["应为非负十进制单调版本"]),
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
    storage: "indexedDB",
    key: IDB_DATABASE_NAME,
    currentVersion: IDB_DATABASE_VERSION,
    portable: true,
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
    repairMutation(operation, context) {
      // 注入 Storage 是共享诊断层的隔离测试面，不得改写生产 singleton store。
      if (context.storageInjected) return operation()
      return withAgentWorkspaceFileWriteLocks(async () => {
        await refreshAgentWorkspacesRaw()
        return operation()
      })
    },
    async applyRepair(patch, context) {
      if (context.storageInjected) {
        context.applyDefault()
        return
      }
      const next =
        patch.action === "write" && isLocalDataRecord(patch.value)
          ? (patch.value as Partial<WorkspacesState>)
          : {}
      // repairMutation 已持有 tasks→workspaces；Raw commit 推进 revision 并发布失效。
      await repairPublicWorkspacesStateRaw(next)
    },
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
