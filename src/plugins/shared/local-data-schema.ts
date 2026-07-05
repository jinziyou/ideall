import { SYNC_CODE_STORAGE_KEY } from "@/lib/sync-code"
import { WORKSPACE_STORAGE_KEY } from "@/lib/workspace-storage"
import { AUDIO_DB_NAME, AUDIO_DB_VERSION } from "@/plugins/audio/audio-store"
import { DATABASE_DB_NAME, DATABASE_DB_VERSION } from "@/plugins/database/database-store"
import { GIT_REPOS_STORAGE_KEY } from "@/plugins/git/git-repos-store"
import { ACP_SETTINGS_STORAGE_KEY } from "@/plugins/agent/lib/acp/acp-settings"
import { AGENT_MCP_STORAGE_KEY } from "@/plugins/agent/lib/agent-mcp-registry"
import { AGENT_RULES_STORAGE_KEY } from "@/plugins/agent/lib/agent-rules"
import { AGENT_SECRETS_STORAGE_KEY } from "@/plugins/agent/lib/agent-secrets"
import { AGENT_SETTINGS_STORAGE_KEY } from "@/plugins/agent/lib/agent-settings"
import { AGENT_SKILLS_STORAGE_KEY } from "@/plugins/agent/lib/agent-skills"
import { AGENT_TASKS_STORAGE_KEY } from "@/plugins/agent/lib/agent-tasks"
import { AGENT_WORKSPACES_STORAGE_KEY } from "@/plugins/agent/lib/agent-workspace"

export type LocalDataStorageKind = "localStorage" | "sessionStorage" | "indexedDB"
export type LocalDataSchemaStatus = "ok" | "missing" | "warning" | "error" | "unknown"

export type LocalDataSchema = {
  id: string
  label: string
  owner: string
  storage: LocalDataStorageKind
  key: string
  currentVersion: number
  sensitive?: boolean
  portable?: boolean
  parseAs?: "json" | "text"
  validate?: (value: unknown, raw: string) => string[]
}

export type LocalDataSchemaInspection = {
  id: string
  label: string
  owner: string
  storage: LocalDataStorageKind
  key: string
  currentVersion: number
  status: LocalDataSchemaStatus
  sensitive: boolean
  portable: boolean
  bytes: number | null
  detail: string
  issues: string[]
}

type StorageLike = Pick<Storage, "getItem">

export type IndexedDbListing = { name?: string | null; version?: number | null }

export type LocalDataSchemaInspectInput = {
  localStorage?: StorageLike
  sessionStorage?: StorageLike
  indexedDBDatabases?: () => Promise<IndexedDbListing[] | undefined>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isJsonArray(value: unknown): string[] {
  return Array.isArray(value) ? [] : ["应为 JSON 数组"]
}

function isJsonObject(value: unknown): string[] {
  return isRecord(value) ? [] : ["应为 JSON 对象"]
}

function agentSettingsIssues(value: unknown): string[] {
  if (!isRecord(value)) return ["应为 JSON 对象"]
  return typeof value.apiKey === "string" && value.apiKey.trim() ? ["仍包含旧版明文 API Key"] : []
}

function agentSecretsIssues(value: unknown): string[] {
  if (!Array.isArray(value)) return ["应为 JSON 数组"]
  const localValues = value.filter(
    (item) => isRecord(item) && typeof item.value === "string" && item.value.trim(),
  ).length
  return localValues ? [`${localValues} 个密钥仍含明文 value`] : []
}

function agentWorkspacesIssues(value: unknown): string[] {
  if (!isRecord(value)) return ["应为 JSON 对象"]
  const workspaces = Array.isArray(value.workspaces) ? value.workspaces : []
  const localKeys = workspaces.filter((workspace) => {
    if (!isRecord(workspace) || !isRecord(workspace.model)) return false
    return typeof workspace.model.apiKey === "string" && workspace.model.apiKey.trim()
  }).length
  return localKeys ? [`${localKeys} 个工作区模型覆盖仍含明文 API Key`] : []
}

export const LOCAL_DATA_SCHEMAS: LocalDataSchema[] = [
  {
    id: "workspace.session",
    label: "工作区会话快照",
    owner: "workspace",
    storage: "sessionStorage",
    key: WORKSPACE_STORAGE_KEY,
    currentVersion: 1,
    parseAs: "json",
    validate: isJsonObject,
  },
  {
    id: "workspace.local",
    label: "工作区恢复快照",
    owner: "workspace",
    storage: "localStorage",
    key: WORKSPACE_STORAGE_KEY,
    currentVersion: 1,
    parseAs: "json",
    validate: isJsonObject,
  },
  {
    id: "audio.db",
    label: "音频播放列表",
    owner: "audio",
    storage: "indexedDB",
    key: AUDIO_DB_NAME,
    currentVersion: AUDIO_DB_VERSION,
    portable: true,
  },
  {
    id: "database.db",
    label: "数据库工作台",
    owner: "database",
    storage: "indexedDB",
    key: DATABASE_DB_NAME,
    currentVersion: DATABASE_DB_VERSION,
    portable: true,
  },
  {
    id: "git.repos",
    label: "Git 仓库列表",
    owner: "git",
    storage: "localStorage",
    key: GIT_REPOS_STORAGE_KEY,
    currentVersion: 1,
    portable: true,
    parseAs: "json",
    validate: isJsonArray,
  },
  {
    id: "agent.settings",
    label: "AI 助手全局设置",
    owner: "agent",
    storage: "localStorage",
    key: AGENT_SETTINGS_STORAGE_KEY,
    currentVersion: 1,
    sensitive: true,
    portable: true,
    parseAs: "json",
    validate: agentSettingsIssues,
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
    validate: isJsonArray,
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
    validate: isJsonArray,
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
    validate: isJsonArray,
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
    validate: isJsonArray,
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
  },
  {
    id: "agent.acp",
    label: "ACP 接入设置",
    owner: "agent",
    storage: "localStorage",
    key: ACP_SETTINGS_STORAGE_KEY,
    currentVersion: 1,
    parseAs: "json",
    validate: isJsonObject,
  },
  {
    id: "sync.code",
    label: "同步码",
    owner: "sync",
    storage: "localStorage",
    key: SYNC_CODE_STORAGE_KEY,
    currentVersion: 1,
    sensitive: true,
    parseAs: "text",
    validate: (_value, raw) => (raw.trim() ? ["同步码是本机能力凭证, 不进入插件数据导出"] : []),
  },
]

function safeStorage(name: "localStorage" | "sessionStorage"): StorageLike | undefined {
  try {
    return typeof window === "undefined" ? undefined : window[name]
  } catch {
    return undefined
  }
}

function storageForSchema(
  schema: LocalDataSchema,
  input: LocalDataSchemaInspectInput,
): StorageLike | undefined {
  if (schema.storage === "localStorage") return input.localStorage ?? safeStorage("localStorage")
  if (schema.storage === "sessionStorage") {
    return input.sessionStorage ?? safeStorage("sessionStorage")
  }
  return undefined
}

function inspectStorageSchema(
  schema: LocalDataSchema,
  input: LocalDataSchemaInspectInput,
): LocalDataSchemaInspection {
  const storage = storageForSchema(schema, input)
  if (!storage) {
    return {
      ...baseInspection(schema),
      status: "unknown",
      bytes: null,
      detail: `${schema.storage} 不可用`,
      issues: [`${schema.storage} 不可用`],
    }
  }

  let raw: string | null
  try {
    raw = storage.getItem(schema.key)
  } catch (error) {
    return {
      ...baseInspection(schema),
      status: "error",
      bytes: null,
      detail: "读取失败",
      issues: [error instanceof Error ? error.message : String(error)],
    }
  }

  if (!raw) {
    return {
      ...baseInspection(schema),
      status: "missing",
      bytes: 0,
      detail: "尚未创建",
      issues: [],
    }
  }

  let parsed: unknown = raw
  if (schema.parseAs === "json") {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return {
        ...baseInspection(schema),
        status: "error",
        bytes: new TextEncoder().encode(raw).byteLength,
        detail: "JSON 损坏",
        issues: ["JSON 解析失败"],
      }
    }
  }

  const issues = schema.validate?.(parsed, raw) ?? []
  return {
    ...baseInspection(schema),
    status: issues.length ? "warning" : "ok",
    bytes: new TextEncoder().encode(raw).byteLength,
    detail: issues.length ? issues.join(" / ") : "结构正常",
    issues,
  }
}

function baseInspection(
  schema: LocalDataSchema,
): Omit<LocalDataSchemaInspection, "status" | "bytes" | "detail" | "issues"> {
  return {
    id: schema.id,
    label: schema.label,
    owner: schema.owner,
    storage: schema.storage,
    key: schema.key,
    currentVersion: schema.currentVersion,
    sensitive: Boolean(schema.sensitive),
    portable: Boolean(schema.portable),
  }
}

async function inspectIndexedDbSchema(
  schema: LocalDataSchema,
  input: LocalDataSchemaInspectInput,
): Promise<LocalDataSchemaInspection> {
  const listDatabases =
    input.indexedDBDatabases ??
    (async () => {
      try {
        const idb = typeof indexedDB === "undefined" ? undefined : indexedDB
        const list = (
          idb as (IDBFactory & { databases?: () => Promise<IndexedDbListing[]> }) | undefined
        )?.databases
        return list ? await list.call(idb) : undefined
      } catch {
        return undefined
      }
    })
  const databases = await listDatabases()
  if (!databases) {
    return {
      ...baseInspection(schema),
      status: "unknown",
      bytes: null,
      detail: "浏览器未暴露 IndexedDB 列表",
      issues: [],
    }
  }

  const found = databases.find((db) => db.name === schema.key)
  if (!found) {
    return {
      ...baseInspection(schema),
      status: "missing",
      bytes: null,
      detail: "尚未创建",
      issues: [],
    }
  }
  const version = found.version ?? schema.currentVersion
  const issues =
    version === schema.currentVersion ? [] : [`当前 v${version}, 期望 v${schema.currentVersion}`]
  return {
    ...baseInspection(schema),
    status: issues.length ? "warning" : "ok",
    bytes: null,
    detail: issues.length ? issues.join(" / ") : `IndexedDB v${version}`,
    issues,
  }
}

export async function inspectLocalDataSchemas(
  input: LocalDataSchemaInspectInput = {},
): Promise<LocalDataSchemaInspection[]> {
  return Promise.all(
    LOCAL_DATA_SCHEMAS.map((schema) =>
      schema.storage === "indexedDB"
        ? inspectIndexedDbSchema(schema, input)
        : inspectStorageSchema(schema, input),
    ),
  )
}
