import {
  createPluginDataPackage,
  parseExpectedPluginDataPackage,
  stringifyPluginDataPackage,
  type PluginDataPackage,
} from "@/plugins/shared/plugin-data"
import { AGENT_CONFIG_SECTION_IDS, type AgentConfigSection } from "@/plugins/embed/protocol"
import {
  AGENT_SETTINGS_STORAGE_KEY,
  agentSettingsCredentialRevisionSnapshot as credentialRevisionSnapshot,
  agentSettingsSecuritySnapshot,
  clearAgentSettingsApiKey,
  getAgentSettings,
  hydrateAgentSettingsSecure,
  isAgentSettingsCredentialConfigured,
  replaceAgentSettingsPublicDurably,
  setAgentSettingsApiKey,
  setAgentSettings,
  subscribeAgentSettings,
} from "./agent-settings"
import { decodeAgentSettingsDocument } from "../agent-settings-file-contract"
import { AGENT_SECRETS_STORAGE_KEY, agentSecretsSecuritySnapshot } from "./agent-secrets"
import {
  AGENT_MCP_STORAGE_KEY,
  getMcpServers,
  replaceMcpServers,
  subscribeMcpServers,
} from "./agent-mcp-registry"
import { AGENT_RULES_STORAGE_KEY, getRules, replaceRules, subscribeRules } from "./agent-rules"
import { AGENT_SKILLS_STORAGE_KEY, getSkills, replaceSkills, subscribeSkills } from "./agent-skills"
import {
  AGENT_TASKS_STORAGE_KEY,
  getTasks,
  refreshTasksRaw,
  replaceTasksRaw,
  subscribeTasks,
} from "./agent-tasks"
import {
  AGENT_WORKSPACES_STORAGE_KEY,
  agentWorkspacesRevisionSnapshot as workspacesRevisionSnapshot,
  createWorkspaceRaw,
  getWorkspacesState,
  refreshAgentWorkspacesRaw,
  replacePublicWorkspacesStateRaw,
  setActiveWorkspaceRaw,
  subscribeWorkspaces,
} from "./agent-workspace"
import { withAgentWorkspaceFileWriteLocks } from "../agent-workspace-write-adapter"
import type {
  AgentWorkspaceActivateResult,
  AgentWorkspaceCreateResult,
} from "../agent-management-file-contract"
import { ACP_SETTINGS_STORAGE_KEY, parseAcpSettings, setAcpSettings } from "./acp/acp-settings"
import {
  decodeAgentMcpServers,
  decodeAgentRules,
  decodeAgentSettingsPublic,
  decodeAgentSkills,
  decodeAgentTasks,
  decodeAgentWorkspacesState,
  isRecord,
  sanitizeAgentStorageValue,
  sanitizeMcp,
  sanitizeRules,
  sanitizeSettings,
  sanitizeSkills,
  sanitizeTasks,
  sanitizeWorkspaces,
} from "./agent-config-codecs"
import {
  clearMcpOAuthForChangedTargets,
  mergeAgentMcpPublicConfig,
} from "./agent-credential-policy"

export { mergeAgentMcpPublicConfig } from "./agent-credential-policy"

export const AGENT_PLUGIN_ID = "agent"
export const AGENT_PLUGIN_LABEL = "AI 智能体"
export const AGENT_EXPORT_KIND = "ideall.agent.config"
export const AGENT_EXPORT_VERSION = 1
export const AGENT_DATA_SPEC = {
  pluginId: AGENT_PLUGIN_ID,
  pluginLabel: AGENT_PLUGIN_LABEL,
  dataKind: AGENT_EXPORT_KIND,
  dataVersion: AGENT_EXPORT_VERSION,
} as const

const KEYS = [
  AGENT_SETTINGS_STORAGE_KEY,
  AGENT_MCP_STORAGE_KEY,
  AGENT_RULES_STORAGE_KEY,
  AGENT_SKILLS_STORAGE_KEY,
  AGENT_TASKS_STORAGE_KEY,
  AGENT_WORKSPACES_STORAGE_KEY,
  AGENT_SECRETS_STORAGE_KEY,
  ACP_SETTINGS_STORAGE_KEY,
] as const

const SECTION_IDS = AGENT_CONFIG_SECTION_IDS

export type AgentPublicConfigSectionId = AgentConfigSection

export type AgentPublicConfigSectionDefinition = Readonly<{
  id: AgentPublicConfigSectionId
  storageKey: (typeof KEYS)[number]
  fileName: string
  label: string
}>

type AgentPublicConfigSectionAdapter = AgentPublicConfigSectionDefinition &
  Readonly<{
    read(): unknown
    validate(value: unknown): void
    write(value: unknown): void | Promise<void>
    subscribe(listener: () => void): () => void
    sanitize(value: unknown): unknown
  }>

function decodePublicWorkspaces(value: unknown) {
  // 原输入先走完整 schema（只额外容许 apiKey 这一明确敏感字段），随后公开投影必须通过
  // 不含密钥字段的 schema；未知字段不能借 sanitize 被静默吞掉后落库。
  decodeAgentWorkspacesState(value, true)
  return decodeAgentWorkspacesState(sanitizeWorkspaces(value))
}

function decodePublicMcp(value: unknown) {
  decodeAgentMcpServers(value)
  return decodeAgentMcpServers(sanitizeMcp(value))
}

function validateMergedPublicMcp(value: unknown): void {
  const servers = decodePublicMcp(value)
  decodeAgentMcpServers(mergeAgentMcpPublicConfig(servers, getMcpServers()))
}

/**
 * 每个公开 section 的唯一注册点：文件定义、codec、真实 store 读写和订阅必须在同一项声明，
 * FileSystem 投影及 dispatch 均由该注册表生成，避免多份 switch 漂移。
 */
const SECTION_ADAPTERS: Record<AgentPublicConfigSectionId, AgentPublicConfigSectionAdapter> = {
  settings: {
    id: "settings",
    storageKey: AGENT_SETTINGS_STORAGE_KEY,
    fileName: "settings.json",
    label: "全局设置",
    read: getAgentSettings,
    validate(value) {
      decodeAgentSettingsPublic(value, getAgentSettings())
    },
    write(value) {
      return setAgentSettings(decodeAgentSettingsPublic(value, getAgentSettings()))
    },
    subscribe: subscribeAgentSettings,
    sanitize: sanitizeSettings,
  },
  workspaces: {
    id: "workspaces",
    storageKey: AGENT_WORKSPACES_STORAGE_KEY,
    fileName: "workspaces.json",
    label: "工作区",
    read: getWorkspacesState,
    validate(value) {
      decodePublicWorkspaces(value)
    },
    write(value) {
      // provider/importer 已持有 tasks→workspaces；Raw 避免同锁重入。
      return replacePublicWorkspacesStateRaw(decodePublicWorkspaces(value))
    },
    subscribe: subscribeWorkspaces,
    sanitize: sanitizeWorkspaces,
  },
  rules: {
    id: "rules",
    storageKey: AGENT_RULES_STORAGE_KEY,
    fileName: "rules.json",
    label: "规则",
    read: getRules,
    validate(value) {
      decodeAgentRules(value)
    },
    write(value) {
      replaceRules(decodeAgentRules(value))
    },
    subscribe: subscribeRules,
    sanitize: sanitizeRules,
  },
  skills: {
    id: "skills",
    storageKey: AGENT_SKILLS_STORAGE_KEY,
    fileName: "skills.json",
    label: "技能",
    read: getSkills,
    validate(value) {
      decodeAgentSkills(value)
    },
    write(value) {
      replaceSkills(decodeAgentSkills(value))
    },
    subscribe: subscribeSkills,
    sanitize: sanitizeSkills,
  },
  mcp: {
    id: "mcp",
    storageKey: AGENT_MCP_STORAGE_KEY,
    fileName: "mcp.json",
    label: "MCP",
    read: getMcpServers,
    validate: validateMergedPublicMcp,
    write(value) {
      const servers = decodePublicMcp(value)
      const current = getMcpServers()
      const merged = decodeAgentMcpServers(mergeAgentMcpPublicConfig(servers, current))
      clearMcpOAuthForChangedTargets(merged, current)
      replaceMcpServers(merged)
    },
    subscribe: subscribeMcpServers,
    sanitize: sanitizeMcp,
  },
  tasks: {
    id: "tasks",
    storageKey: AGENT_TASKS_STORAGE_KEY,
    fileName: "tasks.json",
    label: "任务",
    read: getTasks,
    validate(value) {
      decodeAgentTasks(value)
    },
    write(value) {
      // provider/importer 已持有 config:tasks 锁；直接调用 raw 原语避免同锁重入。
      return replaceTasksRaw(decodeAgentTasks(value))
    },
    subscribe: subscribeTasks,
    sanitize: sanitizeTasks,
  },
}

/** Agent 文件系统只投影可公开、可由现有 UI store 实时消费的配置域。 */
export const AGENT_PUBLIC_CONFIG_SECTIONS: readonly AgentPublicConfigSectionDefinition[] =
  SECTION_IDS.map((id) => {
    const { storageKey, fileName, label } = SECTION_ADAPTERS[id]
    return Object.freeze({ id, storageKey, fileName, label })
  })

export type AgentConfigPayload = {
  values: Partial<Record<(typeof KEYS)[number], unknown>>
}

export type AgentConfigExport = PluginDataPackage<
  AgentConfigPayload,
  typeof AGENT_EXPORT_KIND,
  typeof AGENT_EXPORT_VERSION
>

function sectionAdapter(id: AgentPublicConfigSectionId): AgentPublicConfigSectionAdapter {
  const adapter = SECTION_ADAPTERS[id]
  if (!adapter) throw new Error(`未知 Agent 配置分区: ${id}`)
  return adapter
}

function storage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage
  } catch {
    return undefined
  }
}

function readJson(key: string): unknown {
  const raw = storage()?.getItem(key)
  if (!raw) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

function writeJson(key: string, value: unknown): void {
  if (value === undefined) return
  storage()?.setItem(key, JSON.stringify(value))
}

/** 读取正在被 Agent UI 使用的 store 快照，而不是面板描述或另一份缓存。 */
export function readAgentPublicConfigSection(id: AgentPublicConfigSectionId): unknown {
  const adapter = sectionAdapter(id)
  return adapter.sanitize(adapter.read())
}

/**
 * 写回公开配置并走现有 store commit/subscribe 通路。调用方不能借此设置、清空或读取
 * secure API Key / token；已有值仅在相同凭据目标的公开 JSON 往返时保持不变。
 */
export function writeAgentPublicConfigSection(
  id: AgentPublicConfigSectionId,
  value: unknown,
): void | Promise<void> {
  const adapter = sectionAdapter(id)
  adapter.validate(value)
  return adapter.write(value)
}

/**
 * FileSystem 的耐久写边界。公开 settings 改变凭据 endpoint 时，必须先确认旧凭据已从
 * secure-store 删除，再提交新 endpoint；删除失败时公开文档保持原状。
 */
export async function writeAgentPublicConfigFileSection(
  id: AgentPublicConfigSectionId,
  value: unknown,
): Promise<void> {
  if (id !== "settings") {
    await writeAgentPublicConfigSection(id, value)
    return
  }
  await replaceAgentSettingsPublicDurably((current) => {
    const next = decodeAgentSettingsPublic(value, current)
    decodeAgentSettingsDocument({
      baseURL: next.baseURL,
      model: next.model,
      includeHomeContext: next.includeHomeContext,
      defaultAgentMode: next.defaultAgentMode,
      approvalPolicy: next.approvalPolicy,
    })
    return next
  })
}

/** 订阅与对应 UI 相同的 store 变更源，供 FileSystem watch 适配。 */
export function subscribeAgentPublicConfigSection(
  id: AgentPublicConfigSectionId,
  listener: () => void,
): () => void {
  return sectionAdapter(id).subscribe(listener)
}

export function sanitizeAgentPublicConfigSection(
  id: AgentPublicConfigSectionId,
  value: unknown,
): unknown {
  return sectionAdapter(id).sanitize(value)
}

/**
 * FileSystem 读取同步 store 快照前的耐久水合边界。settings 的语义版本依赖 secure-store
 * 中的凭据存在性，必须先完成水合；tasks 同时影响 workspaces 的派生 taskCount。
 */
export async function prepareAgentPublicConfigSection(
  id: AgentPublicConfigSectionId,
): Promise<void> {
  if (id === "settings") {
    await hydrateAgentSettingsSecure()
    return
  }
  // Agent provider 在 tasks/workspaces 的 prepare 外层已持有规范锁；这里只调用 Raw。
  if (id === "tasks") {
    await refreshTasksRaw()
    return
  }
  if (id === "workspaces") {
    await refreshTasksRaw()
    await refreshAgentWorkspacesRaw()
  }
}

/** settings.json 之外的本机凭据通道：只暴露布尔状态，永不返回密钥。 */
export function agentSettingsCredentialConfiguredSnapshot(): boolean {
  return isAgentSettingsCredentialConfigured()
}

/** 只投影不透明 revision，公开设置正文和导出均不包含该本机元数据。 */
export function agentSettingsCredentialRevisionSnapshot(): string {
  return credentialRevisionSnapshot()
}

/** workspace 的本机单调 revision；不包含或派生任何凭据内容。 */
export function agentWorkspacesRevisionSnapshot(): string {
  return workspacesRevisionSnapshot()
}

export async function readAgentSettingsCredentialConfigured(): Promise<boolean> {
  const settings = await hydrateAgentSettingsSecure()
  return Boolean(settings.apiKey.trim())
}

export function writeAgentSettingsApiKey(apiKey: string): Promise<void> {
  return setAgentSettingsApiKey(apiKey)
}

export function deleteAgentSettingsApiKey(): Promise<void> {
  return clearAgentSettingsApiKey()
}

export async function createAgentWorkspace(name?: string): Promise<AgentWorkspaceCreateResult> {
  const workspace = await createWorkspaceRaw(name)
  return { workspaceId: workspace.id, name: workspace.name }
}

export class AgentWorkspaceNotFoundError extends Error {
  constructor() {
    super("Agent workspace not found")
    this.name = "AgentWorkspaceNotFoundError"
  }
}

export async function activateAgentWorkspace(
  workspaceId: string,
): Promise<AgentWorkspaceActivateResult> {
  if (!getWorkspacesState().workspaces.some((workspace) => workspace.id === workspaceId)) {
    throw new AgentWorkspaceNotFoundError()
  }
  await setActiveWorkspaceRaw(workspaceId)
  return { workspaceId }
}

export function createAgentConfigExport(
  values: AgentConfigPayload["values"],
  exportedAt = new Date().toISOString(),
): AgentConfigExport {
  return createPluginDataPackage(AGENT_DATA_SPEC, { values }, exportedAt)
}

export function parseAgentConfigExport(raw: string): AgentConfigExport {
  const pack = parseExpectedPluginDataPackage(raw, AGENT_DATA_SPEC)
  const values = isRecord(pack.payload) ? pack.payload.values : undefined
  if (!isRecord(values)) {
    throw new Error("Agent JSON 缺少 values")
  }
  return createAgentConfigExport(
    Object.fromEntries(KEYS.map((key) => [key, sanitizeAgentStorageValue(key, values[key])])),
    pack.exportedAt,
  )
}

/**
 * tasks 与 workspaces 共同组成 workspace 公开快照；刷新和读取必须位于同一双锁临界区，
 * 否则两次顺序加锁之间仍可能混入 task/workspace mutation，导出撕裂状态。
 */
function withFreshAgentRuntimeConfig<T>(read: () => T): Promise<T> {
  return withAgentWorkspaceFileWriteLocks(async () => {
    await refreshTasksRaw()
    await refreshAgentWorkspacesRaw()
    return read()
  })
}

export async function exportAgentConfigJson(): Promise<string> {
  return withFreshAgentRuntimeConfig(() => {
    const publicByStorageKey = new Map<string, unknown>(
      AGENT_PUBLIC_CONFIG_SECTIONS.map((item) => [
        item.storageKey,
        readAgentPublicConfigSection(item.id),
      ]),
    )
    const values = Object.fromEntries(
      KEYS.map((key) => [
        key,
        publicByStorageKey.get(key) ?? sanitizeAgentStorageValue(key, readJson(key)),
      ]),
    )
    return stringifyPluginDataPackage(createAgentConfigExport(values))
  })
}

/** Store 级导入原语；生产 PluginDataPort 必须经 agent-settings-write-adapter 取得 settings 锁。 */
export async function importAgentConfigJson(raw: string): Promise<{ keys: number }> {
  const pack = parseAgentConfigExport(raw)
  const publicByStorageKey = new Map<string, AgentPublicConfigSectionId>(
    AGENT_PUBLIC_CONFIG_SECTIONS.map((item) => [item.storageKey, item.id]),
  )
  const entries = Object.entries(pack.payload.values).filter((entry) => entry[1] !== undefined)
  // 所有公开 section 先做无副作用预校验，避免后段 codec 失败时前段 store 已经提交。
  for (const [key, value] of entries) {
    const publicId = publicByStorageKey.get(key)
    if (publicId) sectionAdapter(publicId).validate(value)
  }
  // 生产 importer 已持有全部 section 锁；凭据保留策略必须基于最新 workspace 真值。
  if (entries.some(([key]) => key === AGENT_WORKSPACES_STORAGE_KEY)) {
    await refreshAgentWorkspacesRaw()
  }
  let keys = 0
  for (const [key, value] of entries) {
    const publicId = publicByStorageKey.get(key)
    if (publicId === "settings") await writeAgentPublicConfigFileSection(publicId, value)
    else if (publicId) await writeAgentPublicConfigSection(publicId, value)
    else if (key === ACP_SETTINGS_STORAGE_KEY) {
      setAcpSettings(parseAcpSettings(JSON.stringify(value)))
    } else writeJson(key, value)
    keys += 1
  }
  return { keys }
}

export async function inspectAgentConfigData(): Promise<{
  keys: number
  bytes: number
  localSensitiveValues: number
}> {
  return withFreshAgentRuntimeConfig(() => {
    const publicByStorageKey = new Map<string, unknown>(
      AGENT_PUBLIC_CONFIG_SECTIONS.map((item) => [
        item.storageKey,
        readAgentPublicConfigSection(item.id),
      ]),
    )
    const values = Object.fromEntries(
      KEYS.map((key) => [key, publicByStorageKey.get(key) ?? readJson(key)]),
    )
    const settings = agentSettingsSecuritySnapshot()
    const secrets = agentSecretsSecuritySnapshot()
    return {
      keys: Object.values(values).filter((value) => value !== undefined).length,
      bytes: new TextEncoder().encode(JSON.stringify(values)).byteLength,
      localSensitiveValues: Number(settings.localApiKeyPresent) + secrets.localValueCount,
    }
  })
}
