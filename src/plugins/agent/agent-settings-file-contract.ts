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
export const AGENT_SETTINGS_ACP_READ_ACTION = "acp.settings.read"
export const AGENT_SETTINGS_ACP_WRITE_ACTION = "acp.settings.write"
export const AGENT_SETTINGS_ACP_DETECT_ACTION = "acp.agent.detect"
export const AGENT_SETTINGS_ACP_PROBE_ACTION = "acp.agent.probe"
export const MAX_AGENT_SETTINGS_BASE_URL_LENGTH = 2_048
export const MAX_AGENT_SETTINGS_MODEL_LENGTH = 256
export const MAX_AGENT_SETTINGS_API_KEY_LENGTH = 16_384

export type AgentSettingsCredentialStatus = Readonly<{ configured: boolean }>
export type AgentSettingsSetApiKeyInput = Readonly<{ apiKey: string }>

export type AgentExecutionBackend = "model" | "external-acp"

export type AgentExternalAcpConfig = Readonly<{
  program: string
  args: string
  cwd: string
}>

export type AgentAcpSettings = Readonly<{
  allowEditorConnect: boolean
  listenPort: number
  externalAgent: AgentExternalAcpConfig
  executionBackend: AgentExecutionBackend
}>

export const DEFAULT_AGENT_ACP_SETTINGS: AgentAcpSettings = {
  allowEditorConnect: false,
  listenPort: 0,
  externalAgent: { program: "", args: "", cwd: "" },
  executionBackend: "model",
}

export type AgentDetectedAcpAgent = Readonly<{
  id: string
  label: string
  note?: string
  config: AgentExternalAcpConfig
}>

export type AgentAcpProbeInput = Readonly<{ externalAgent: AgentExternalAcpConfig }>
export type AgentAcpProbeResult = Readonly<{ latencyMs: number; protocolVersion: number }>

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

function boundedCommandField(
  value: Record<string, unknown>,
  key: string,
  label: string,
  maxLength: number,
): string {
  const field = value[key]
  if (typeof field !== "string") throw new Error(`${label}.${key}必须是字符串`)
  if (field.length > maxLength) throw new Error(`${label}.${key}过长`)
  if (/[\u0000\r\n]/u.test(field)) throw new Error(`${label}.${key}不能包含控制字符`)
  return field
}

export function decodeAgentExternalAcpConfig(value: unknown): AgentExternalAcpConfig {
  const source = record(value, "外部 ACP Agent 配置")
  assertOnlyKeys(source, ["program", "args", "cwd"], "外部 ACP Agent 配置")
  return {
    program: boundedCommandField(source, "program", "外部 ACP Agent 配置", 512),
    args: boundedCommandField(source, "args", "外部 ACP Agent 配置", 8_192),
    cwd: boundedCommandField(source, "cwd", "外部 ACP Agent 配置", 4_096),
  }
}

export function decodeAgentAcpSettings(value: unknown): AgentAcpSettings {
  const source = record(value, "ACP 设置")
  assertOnlyKeys(
    source,
    ["allowEditorConnect", "listenPort", "externalAgent", "executionBackend"],
    "ACP 设置",
  )
  const port = source.listenPort
  if (typeof port !== "number" || !Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("ACP 设置.listenPort无效")
  }
  if (source.executionBackend !== "model" && source.executionBackend !== "external-acp") {
    throw new Error("ACP 设置.executionBackend无效")
  }
  return {
    allowEditorConnect: booleanField(source, "allowEditorConnect", "ACP 设置"),
    listenPort: port,
    externalAgent: decodeAgentExternalAcpConfig(source.externalAgent),
    executionBackend: source.executionBackend,
  }
}

export function decodeAgentDetectedAcpAgents(value: unknown): AgentDetectedAcpAgent[] {
  if (!Array.isArray(value) || value.length > 64) throw new Error("ACP Agent 检测结果无效")
  return value.map((item, index) => {
    const label = `ACP Agent 检测结果[${index}]`
    const source = record(item, label)
    assertOnlyKeys(source, ["id", "label", "note", "config"], label)
    const id = boundedCommandField(source, "id", label, 128)
    const name = boundedCommandField(source, "label", label, 160)
    const note = source.note
    if (
      note !== undefined &&
      (typeof note !== "string" || note.length > 240 || /[\u0000-\u001f\u007f]/u.test(note))
    ) {
      throw new Error(`${label}.note无效`)
    }
    return {
      id,
      label: name,
      ...(note ? { note } : {}),
      config: decodeAgentExternalAcpConfig(source.config),
    }
  })
}

export function decodeAgentAcpProbeInput(value: unknown): AgentAcpProbeInput {
  const source = record(value, "ACP Agent 诊断输入")
  assertOnlyKeys(source, ["externalAgent"], "ACP Agent 诊断输入")
  const externalAgent = decodeAgentExternalAcpConfig(source.externalAgent)
  if (!externalAgent.program.trim()) throw new Error("ACP Agent 诊断输入.program不能为空")
  return { externalAgent }
}

export function decodeAgentAcpProbeResult(value: unknown): AgentAcpProbeResult {
  const source = record(value, "ACP Agent 诊断结果")
  assertOnlyKeys(source, ["latencyMs", "protocolVersion"], "ACP Agent 诊断结果")
  const { latencyMs, protocolVersion } = source
  if (
    typeof latencyMs !== "number" ||
    !Number.isSafeInteger(latencyMs) ||
    latencyMs < 0 ||
    typeof protocolVersion !== "number" ||
    !Number.isSafeInteger(protocolVersion) ||
    protocolVersion < 0
  ) {
    throw new Error("ACP Agent 诊断结果无效")
  }
  return { latencyMs, protocolVersion }
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
