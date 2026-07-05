import {
  createPluginDataPackage,
  parseExpectedPluginDataPackage,
  stringifyPluginDataPackage,
  type PluginDataPackage,
} from "@/plugins/shared/plugin-data"
import {
  AGENT_SETTINGS_STORAGE_KEY,
  agentSettingsSecuritySnapshot,
  type AgentSettings,
} from "./agent-settings"
import { AGENT_SECRETS_STORAGE_KEY, agentSecretsSecuritySnapshot } from "./agent-secrets"
import { AGENT_MCP_STORAGE_KEY } from "./agent-mcp-registry"
import { AGENT_RULES_STORAGE_KEY } from "./agent-rules"
import { AGENT_TASKS_STORAGE_KEY } from "./agent-tasks"
import { AGENT_WORKSPACES_STORAGE_KEY, type WorkspacesState } from "./agent-workspace"
import { ACP_SETTINGS_STORAGE_KEY } from "./acp/acp-settings"

export const AGENT_PLUGIN_ID = "agent"
export const AGENT_PLUGIN_LABEL = "AI 助手"
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
  AGENT_TASKS_STORAGE_KEY,
  AGENT_WORKSPACES_STORAGE_KEY,
  AGENT_SECRETS_STORAGE_KEY,
  ACP_SETTINGS_STORAGE_KEY,
] as const

export type AgentConfigPayload = {
  values: Partial<Record<(typeof KEYS)[number], unknown>>
}

export type AgentConfigExport = PluginDataPackage<
  AgentConfigPayload,
  typeof AGENT_EXPORT_KIND,
  typeof AGENT_EXPORT_VERSION
>

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

function sanitizeSettings(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value
  const settings = value as Partial<AgentSettings>
  const { apiKey: _apiKey, ...rest } = settings
  return rest
}

function sanitizeWorkspaces(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value
  const state = value as Partial<WorkspacesState>
  if (!Array.isArray(state.workspaces)) return value
  return {
    ...state,
    workspaces: state.workspaces.map((workspace) => ({
      ...workspace,
      model: workspace.model ? { ...workspace.model, apiKey: "" } : workspace.model,
    })),
  }
}

function sanitizeSecrets(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value
    .filter((item): item is { id: unknown } => Boolean(item) && typeof item === "object")
    .map((item) => ({ id: typeof item.id === "string" ? item.id : "", value: "", secure: true }))
    .filter((item) => item.id)
}

function sanitizeValue(key: string, value: unknown): unknown {
  if (key === AGENT_SETTINGS_STORAGE_KEY) return sanitizeSettings(value)
  if (key === AGENT_WORKSPACES_STORAGE_KEY) return sanitizeWorkspaces(value)
  if (key === AGENT_SECRETS_STORAGE_KEY) return sanitizeSecrets(value)
  return value
}

export function createAgentConfigExport(
  values: AgentConfigPayload["values"],
  exportedAt = new Date().toISOString(),
): AgentConfigExport {
  return createPluginDataPackage(AGENT_DATA_SPEC, { values }, exportedAt)
}

export function parseAgentConfigExport(raw: string): AgentConfigExport {
  const pack = parseExpectedPluginDataPackage(raw, AGENT_DATA_SPEC)
  const values =
    pack.payload && typeof pack.payload === "object" && !Array.isArray(pack.payload)
      ? (pack.payload as AgentConfigPayload).values
      : undefined
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    throw new Error("Agent JSON 缺少 values")
  }
  return createAgentConfigExport(
    Object.fromEntries(
      KEYS.map((key) => [key, sanitizeValue(key, (values as Record<string, unknown>)[key])]),
    ),
    pack.exportedAt,
  )
}

export async function exportAgentConfigJson(): Promise<string> {
  const values = Object.fromEntries(KEYS.map((key) => [key, sanitizeValue(key, readJson(key))]))
  return stringifyPluginDataPackage(createAgentConfigExport(values))
}

export async function importAgentConfigJson(raw: string): Promise<{ keys: number }> {
  const pack = parseAgentConfigExport(raw)
  for (const [key, value] of Object.entries(pack.payload.values)) writeJson(key, value)
  return { keys: Object.keys(pack.payload.values).length }
}

export async function inspectAgentConfigData(): Promise<{
  keys: number
  bytes: number
  localSensitiveValues: number
}> {
  const values = Object.fromEntries(KEYS.map((key) => [key, readJson(key)]))
  const settings = agentSettingsSecuritySnapshot()
  const secrets = agentSecretsSecuritySnapshot()
  return {
    keys: Object.values(values).filter((value) => value !== undefined).length,
    bytes: new TextEncoder().encode(JSON.stringify(values)).byteLength,
    localSensitiveValues: Number(settings.localApiKeyPresent) + secrets.localValueCount,
  }
}
