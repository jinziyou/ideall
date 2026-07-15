export type AgentApprovalPolicy = "confirm" | "auto"

/** Agent settings Display 可见、可经 FileSystem 往返的公开文档。 */
export type AgentSettingsDocument = Readonly<{
  baseURL: string
  model: string
  includeHomeContext: boolean
  defaultAgentMode: boolean
  approvalPolicy: AgentApprovalPolicy
}>

export type AgentProviderPreset = Readonly<{
  label: string
  baseURL: string
  model: string
}>

export const PROVIDER_PRESETS: readonly AgentProviderPreset[] = [
  { label: "DeepSeek", baseURL: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { label: "OpenAI", baseURL: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { label: "本地 vLLM", baseURL: "http://127.0.0.1:8000/v1", model: "" },
] as const

export const DEFAULT_AGENT_SETTINGS_DOCUMENT: AgentSettingsDocument = {
  baseURL: PROVIDER_PRESETS[0]!.baseURL,
  model: PROVIDER_PRESETS[0]!.model,
  includeHomeContext: true,
  defaultAgentMode: true,
  approvalPolicy: "confirm",
}

export const AGENT_SETTINGS_CREDENTIAL_STATUS_ACTION = "credential-status"
export const AGENT_SETTINGS_SET_API_KEY_ACTION = "set-api-key"
export const AGENT_SETTINGS_CLEAR_API_KEY_ACTION = "clear-api-key"
export const MAX_AGENT_SETTINGS_BASE_URL_LENGTH = 2_048
export const MAX_AGENT_SETTINGS_MODEL_LENGTH = 256
export const MAX_AGENT_SETTINGS_API_KEY_LENGTH = 16_384

export type AgentSettingsCredentialStatus = Readonly<{ configured: boolean }>
export type AgentSettingsSetApiKeyInput = Readonly<{ apiKey: string }>

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}必须是对象`)
  }
  return value as Record<string, unknown>
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key))
  if (extras.length) throw new Error(`${label}包含未知字段: ${extras.join(", ")}`)
}

function documentStringField(
  value: Record<string, unknown>,
  key: string,
  label: string,
  maxLength: number,
): string {
  const field = value[key]
  if (typeof field !== "string") throw new Error(`${label}.${key}必须是字符串`)
  if (field.length > maxLength) throw new Error(`${label}.${key}不能超过 ${maxLength} 个字符`)
  if (field !== field.trim()) throw new Error(`${label}.${key}不能包含首尾空白`)
  if (/[\u0000-\u001f\u007f]/u.test(field)) throw new Error(`${label}.${key}不能包含控制字符`)
  return field
}

function booleanField(value: Record<string, unknown>, key: string, label: string): boolean {
  const field = value[key]
  if (typeof field !== "boolean") throw new Error(`${label}.${key}必须是布尔值`)
  return field
}

/** Display 边界严格解码公开 body；apiKey 和任何未知字段都不能进入 UI 状态。 */
export function decodeAgentSettingsDocument(value: unknown): AgentSettingsDocument {
  const source = record(value, "Agent 全局设置文件")
  assertOnlyKeys(
    source,
    ["baseURL", "model", "includeHomeContext", "defaultAgentMode", "approvalPolicy"],
    "Agent 全局设置文件",
  )
  const approvalPolicy = source.approvalPolicy
  if (approvalPolicy !== "confirm" && approvalPolicy !== "auto") {
    throw new Error("Agent 全局设置文件.approvalPolicy无效")
  }
  return {
    baseURL: documentStringField(
      source,
      "baseURL",
      "Agent 全局设置文件",
      MAX_AGENT_SETTINGS_BASE_URL_LENGTH,
    ),
    model: documentStringField(
      source,
      "model",
      "Agent 全局设置文件",
      MAX_AGENT_SETTINGS_MODEL_LENGTH,
    ),
    includeHomeContext: booleanField(source, "includeHomeContext", "Agent 全局设置文件"),
    defaultAgentMode: booleanField(source, "defaultAgentMode", "Agent 全局设置文件"),
    approvalPolicy,
  }
}

export function decodeAgentSettingsCredentialStatus(value: unknown): AgentSettingsCredentialStatus {
  const source = record(value, "Agent 凭据状态")
  assertOnlyKeys(source, ["configured"], "Agent 凭据状态")
  return { configured: booleanField(source, "configured", "Agent 凭据状态") }
}

export function decodeAgentSettingsSetApiKeyInput(value: unknown): AgentSettingsSetApiKeyInput {
  const source = record(value, "Agent API Key 输入")
  assertOnlyKeys(source, ["apiKey"], "Agent API Key 输入")
  const apiKey = source.apiKey
  if (typeof apiKey !== "string") throw new Error("Agent API Key 输入.apiKey必须是字符串")
  if (!apiKey.trim()) throw new Error("Agent API Key 输入.apiKey不能为空")
  if (apiKey !== apiKey.trim()) throw new Error("Agent API Key 输入.apiKey不能包含首尾空白")
  if (apiKey.length > MAX_AGENT_SETTINGS_API_KEY_LENGTH) {
    throw new Error(`Agent API Key 输入.apiKey不能超过 ${MAX_AGENT_SETTINGS_API_KEY_LENGTH} 个字符`)
  }
  if (/[\u0000-\u001f\u007f]/u.test(apiKey)) {
    throw new Error("Agent API Key 输入.apiKey不能包含控制字符")
  }
  return { apiKey }
}

export function isAgentSettingsDocumentConfigured(
  document: AgentSettingsDocument,
  credentialConfigured: boolean,
): boolean {
  return Boolean(credentialConfigured && document.baseURL.trim() && document.model.trim())
}
