import { AUTH_TOKEN_SECURE_KEY } from "@/lib/auth/auth-store"
import { SYNC_CODE_SECURE_KEY } from "@/lib/sync-code"
import { secureFallbackStorageKey } from "@/lib/secure-store"
import { WORKSPACE_STORAGE_KEY } from "@/lib/workspace-storage"
import { ENGINE_PREFERENCES_STORAGE_KEY } from "@/engines/preferences"
import { STARTUP_TARGET_STORAGE_KEY } from "@/lib/workspace-storage"
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
  repair?: (value: unknown, raw: string) => LocalDataSchemaRepairPatch | null
}

export type LocalDataSchemaRepairPatch =
  | { action: "remove"; detail: string }
  | { action: "write"; value: unknown; detail: string }

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
  repairable: boolean
}

type StorageLike = Pick<Storage, "getItem">
type MutableStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">

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

function repairJsonObject(value: unknown): LocalDataSchemaRepairPatch {
  return isRecord(value)
    ? { action: "write", value, detail: "已规范化 JSON 对象" }
    : { action: "write", value: {}, detail: "已重置为空对象" }
}

function repairJsonArray(value: unknown): LocalDataSchemaRepairPatch {
  return Array.isArray(value)
    ? { action: "write", value, detail: "已规范化 JSON 数组" }
    : { action: "write", value: [], detail: "已重置为空数组" }
}

function repairAgentSettings(value: unknown): LocalDataSchemaRepairPatch {
  if (!isRecord(value)) return { action: "write", value: {}, detail: "已重置为空设置对象" }
  const next = { ...value }
  delete next.apiKey
  return { action: "write", value: next, detail: "已移除旧版明文 API Key 字段" }
}

function agentSecretsIssues(value: unknown): string[] {
  if (!Array.isArray(value)) return ["应为 JSON 数组"]
  const localValues = value.filter(
    (item) => isRecord(item) && typeof item.value === "string" && item.value.trim(),
  ).length
  return localValues ? [`${localValues} 个密钥仍含明文 value`] : []
}

function repairAgentSecrets(value: unknown): LocalDataSchemaRepairPatch {
  if (!Array.isArray(value)) return { action: "write", value: [], detail: "已重置为空密钥索引" }
  const next = value
    .filter(
      (item): item is Record<string, unknown> => isRecord(item) && typeof item.id === "string",
    )
    .map((item) => ({ ...item, value: "", secure: true }))
  return { action: "write", value: next, detail: "已清理密钥索引中的明文 value" }
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

function repairAgentWorkspaces(value: unknown): LocalDataSchemaRepairPatch {
  if (!isRecord(value))
    return { action: "write", value: { workspaces: [] }, detail: "已重置工作区配置" }
  const workspaces = Array.isArray(value.workspaces) ? value.workspaces : []
  return {
    action: "write",
    value: {
      ...value,
      workspaces: workspaces.map((workspace) => {
        if (!isRecord(workspace) || !isRecord(workspace.model)) return workspace
        const model = { ...workspace.model }
        delete model.apiKey
        return { ...workspace, model }
      }),
    },
    detail: "已移除工作区模型覆盖中的明文 API Key",
  }
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
    repair: () => ({ action: "remove", detail: "已移除损坏的会话快照" }),
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
    repair: () => ({ action: "remove", detail: "已移除损坏的恢复快照" }),
  },
  {
    id: "display.engine-preferences",
    label: "文件默认引擎关联",
    owner: "display",
    storage: "localStorage",
    key: ENGINE_PREFERENCES_STORAGE_KEY,
    currentVersion: 1,
    portable: true,
    parseAs: "json",
    validate: isJsonObject,
    repair: repairJsonObject,
  },
  {
    id: "display.startup-target",
    label: "默认启动文件视图",
    owner: "display",
    storage: "localStorage",
    key: STARTUP_TARGET_STORAGE_KEY,
    currentVersion: 1,
    portable: true,
    parseAs: "json",
    validate: isJsonObject,
    repair: () => ({ action: "remove", detail: "已恢复默认 Home 启动界面" }),
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
    repair: repairJsonArray,
  },
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
    validate: isJsonArray,
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
    validate: isJsonArray,
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
    validate: isJsonArray,
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
    validate: isJsonArray,
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
    validate: isJsonObject,
    repair: repairJsonObject,
  },
  {
    id: "sync.code",
    label: "同步码",
    owner: "sync",
    storage: "localStorage",
    key: secureFallbackStorageKey(SYNC_CODE_SECURE_KEY),
    currentVersion: 1,
    sensitive: true,
    parseAs: "text",
    validate: (_value, raw) => (raw.trim() ? ["同步码是本机能力凭证, 不进入插件数据导出"] : []),
  },
  {
    id: "auth.token",
    label: "登录令牌",
    owner: "auth",
    storage: "localStorage",
    key: secureFallbackStorageKey(AUTH_TOKEN_SECURE_KEY),
    currentVersion: 1,
    sensitive: true,
    parseAs: "text",
    validate: (_value, raw) => (raw.trim() ? ["登录令牌是本机能力凭证, 不进入插件数据导出"] : []),
  },
]

function safeStorage(name: "localStorage" | "sessionStorage"): StorageLike | undefined {
  try {
    return typeof window === "undefined" ? undefined : window[name]
  } catch {
    return undefined
  }
}

function safeMutableStorage(
  name: "localStorage" | "sessionStorage",
): MutableStorageLike | undefined {
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

function mutableStorageForSchema(
  schema: LocalDataSchema,
  input: LocalDataSchemaRepairInput,
): MutableStorageLike | undefined {
  if (schema.storage === "localStorage") {
    return input.localStorage ?? safeMutableStorage("localStorage")
  }
  if (schema.storage === "sessionStorage") {
    return input.sessionStorage ?? safeMutableStorage("sessionStorage")
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
    repairable: Boolean(schema.repair && schema.storage !== "indexedDB"),
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

export type LocalDataSchemaRepairInput = {
  localStorage?: MutableStorageLike
  sessionStorage?: MutableStorageLike
}

export type LocalDataSchemaRepairResult = {
  id: string
  label: string
  ok: boolean
  detail: string
  before: LocalDataSchemaInspection
  after?: LocalDataSchemaInspection
}

function encodeRepairValue(schema: LocalDataSchema, value: unknown): string {
  return schema.parseAs === "text" && typeof value === "string" ? value : JSON.stringify(value)
}

export async function repairLocalDataSchema(
  id: string,
  input: LocalDataSchemaRepairInput = {},
): Promise<LocalDataSchemaRepairResult> {
  const schema = LOCAL_DATA_SCHEMAS.find((entry) => entry.id === id)
  if (!schema) throw new Error(`未知 schema: ${id}`)
  const before = await (schema.storage === "indexedDB"
    ? inspectIndexedDbSchema(schema, {})
    : Promise.resolve(inspectStorageSchema(schema, input)))
  if (!schema.repair || schema.storage === "indexedDB") {
    return {
      id: schema.id,
      label: schema.label,
      ok: false,
      detail: "此 schema 不支持自动修复",
      before,
    }
  }
  const storage = mutableStorageForSchema(schema, input)
  if (!storage) {
    return {
      id: schema.id,
      label: schema.label,
      ok: false,
      detail: `${schema.storage} 不可用`,
      before,
    }
  }
  if (!["warning", "error"].includes(before.status)) {
    return {
      id: schema.id,
      label: schema.label,
      ok: true,
      detail: "无需修复",
      before,
      after: before,
    }
  }

  const raw = storage.getItem(schema.key)
  let parsed: unknown = raw ?? ""
  if (schema.parseAs === "json" && raw) {
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = undefined
    }
  }
  const patch =
    before.status === "error" && parsed === undefined
      ? schema.repair(undefined, raw ?? "")
      : schema.repair(parsed, raw ?? "")
  if (!patch) {
    return { id: schema.id, label: schema.label, ok: false, detail: "没有可执行修复", before }
  }
  if (patch.action === "remove") storage.removeItem(schema.key)
  else storage.setItem(schema.key, encodeRepairValue(schema, patch.value))
  const after = inspectStorageSchema(schema, input)
  return { id: schema.id, label: schema.label, ok: true, detail: patch.detail, before, after }
}

export async function repairLocalDataSchemas(
  ids: string[],
  input: LocalDataSchemaRepairInput = {},
): Promise<LocalDataSchemaRepairResult[]> {
  const results: LocalDataSchemaRepairResult[] = []
  for (const id of ids) {
    results.push(await repairLocalDataSchema(id, input))
  }
  return results
}
