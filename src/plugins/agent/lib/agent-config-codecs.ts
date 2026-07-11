import type { Permission } from "@/plugins/embed/protocol"
import { AGENT_CONFIGURABLE_PERMISSIONS } from "@/plugins/embed/grant"
import { AGENT_SECRETS_STORAGE_KEY } from "./agent-secrets"
import { AGENT_SETTINGS_STORAGE_KEY, DEFAULT_SETTINGS, type AgentSettings } from "./agent-settings"
import {
  AGENT_WORKSPACES_STORAGE_KEY,
  type AgentWorkspace,
  type WorkspacesState,
} from "./agent-workspace"
import { AGENT_MCP_STORAGE_KEY, type McpEnvVar, type McpServer } from "./agent-mcp-registry"
import { AGENT_RULES_STORAGE_KEY, type AgentRule } from "./agent-rules"
import { AGENT_SKILLS_STORAGE_KEY, type AgentSkill } from "./agent-skills"
import { AGENT_TASKS_STORAGE_KEY, type AgentTask } from "./agent-tasks"
import { httpEndpoint, isRemoteTransport } from "./agent-credential-policy"

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export function cloneJson(value: unknown): unknown {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value)) as unknown
}

function sanitizePublicBaseUrl(value: unknown): string {
  if (typeof value !== "string" || !value) return typeof value === "string" ? value : ""
  try {
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") return ""
    url.username = ""
    url.password = ""
    url.search = ""
    url.hash = ""
    return url.toString()
  } catch {
    return ""
  }
}

export function sanitizeSettings(value: unknown): unknown {
  if (!isRecord(value)) return {}
  return cloneJson({
    baseURL: sanitizePublicBaseUrl(value.baseURL),
    model: typeof value.model === "string" ? value.model : undefined,
    includeHomeContext:
      typeof value.includeHomeContext === "boolean" ? value.includeHomeContext : undefined,
    defaultAgentMode:
      typeof value.defaultAgentMode === "boolean" ? value.defaultAgentMode : undefined,
    approvalPolicy:
      value.approvalPolicy === "confirm" || value.approvalPolicy === "auto"
        ? value.approvalPolicy
        : undefined,
  })
}

function publicString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function publicBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function publicNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
}

function publicNullableString(value: unknown): string | null | undefined {
  return value === null ? null : publicString(value)
}

function publicNullableStrings(value: unknown): string[] | null | undefined {
  if (value === null) return null
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined
}

export function sanitizeWorkspaces(value: unknown): unknown {
  if (!isRecord(value)) return { workspaces: [], activeId: "" }
  if (!Array.isArray(value.workspaces)) {
    return { workspaces: [], activeId: typeof value.activeId === "string" ? value.activeId : "" }
  }
  // 公开投影必须按 schema allowlist 构造，而不是 spread 原 store。这样未来新增的敏感字段、
  // 损坏 localStorage 中的未知字段都默认不可见；公开 codec 升级后再显式加入。
  const workspaces = value.workspaces.filter(isRecord).map((workspace) => {
    const data = isRecord(workspace.data) ? workspace.data : {}
    const home = isRecord(data.home) ? data.home : {}
    const capabilities = isRecord(workspace.capabilities) ? workspace.capabilities : {}
    const rules = isRecord(workspace.rules) ? workspace.rules : {}
    const prompt = isRecord(workspace.prompt) ? workspace.prompt : {}
    const model = isRecord(workspace.model) ? workspace.model : {}
    return {
      id: publicString(workspace.id),
      name: publicString(workspace.name),
      data: {
        includeHome: publicBoolean(data.includeHome),
        home: {
          notes: publicBoolean(home.notes),
          subscriptions: publicBoolean(home.subscriptions),
          bookmarks: publicBoolean(home.bookmarks),
          folders: publicBoolean(home.folders),
          files: publicBoolean(home.files),
        },
        dirNodeId: publicNullableString(data.dirNodeId),
        osDir: publicNullableString(data.osDir),
      },
      capabilities: {
        permissions: Array.isArray(capabilities.permissions)
          ? capabilities.permissions.filter(
              (permission): permission is Permission =>
                typeof permission === "string" &&
                AGENT_CONFIGURABLE_PERMISSIONS.includes(permission as Permission),
            )
          : undefined,
        toolAllowlist: publicNullableStrings(capabilities.toolAllowlist),
        skillIds: publicNullableStrings(capabilities.skillIds),
        appIds: publicNullableStrings(capabilities.appIds),
      },
      rules: {
        ruleIds:
          Array.isArray(rules.ruleIds) && rules.ruleIds.every((item) => typeof item === "string")
            ? rules.ruleIds
            : undefined,
      },
      prompt: {
        instructions: publicString(prompt.instructions),
        template: publicString(prompt.template),
        precise: publicBoolean(prompt.precise),
        override: publicString(prompt.override),
      },
      model: {
        useGlobal: publicBoolean(model.useGlobal),
        baseURL: sanitizePublicBaseUrl(model.baseURL),
        model: publicString(model.model),
      },
      createdAt: publicNumber(workspace.createdAt),
      updatedAt: publicNumber(workspace.updatedAt),
    }
  })
  return cloneJson({ workspaces, activeId: publicString(value.activeId) ?? "" })
}

function sanitizeSecrets(value: unknown): unknown {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is { id: unknown } => Boolean(item) && typeof item === "object")
    .map((item) => ({ id: typeof item.id === "string" ? item.id : "", value: "", secure: true }))
    .filter((item) => item.id)
}

const PUBLIC_SECRET_REFERENCE = /^(?:(?:Bearer|Basic)\s+)?\$\{\w+\}$/i

function isPublicSecretReference(value: string): boolean {
  const trimmed = value.trim()
  if (PUBLIC_SECRET_REFERENCE.test(trimmed)) return true
  try {
    return PUBLIC_SECRET_REFERENCE.test(decodeURIComponent(trimmed))
  } catch {
    return false
  }
}

function sanitizeBindings(value: unknown): McpEnvVar[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(
      (item): item is McpEnvVar =>
        isRecord(item) && typeof item.key === "string" && typeof item.value === "string",
    )
    .map((item) => ({
      key: item.key,
      value: isPublicSecretReference(item.value) ? item.value : "",
    }))
}

function sanitizeMcpUrl(value: unknown): string {
  if (typeof value !== "string" || !value) return typeof value === "string" ? value : ""
  try {
    const url = new URL(value)
    url.username = ""
    url.password = ""
    url.hash = ""
    for (const key of [...url.searchParams.keys()]) {
      const parameter = url.searchParams.get(key) ?? ""
      if (!isPublicSecretReference(parameter)) url.searchParams.set(key, "")
    }
    return url.toString()
  } catch {
    return ""
  }
}

/** MCP public config 保留连接结构与 ${NAME} 引用，但不暴露内嵌认证值。 */
export function sanitizeMcp(value: unknown): unknown {
  if (!Array.isArray(value)) return []
  const projection = value.filter(isRecord).map((server) => ({
    id: typeof server.id === "string" ? server.id : "",
    name: typeof server.name === "string" ? server.name : "",
    transport: server.transport,
    command: typeof server.command === "string" ? server.command : "",
    args: "",
    url: sanitizeMcpUrl(server.url),
    env: sanitizeBindings(server.env),
    headers: sanitizeBindings(server.headers),
    auth: server.auth,
    enabled: server.enabled,
    builtin: server.builtin,
    createdAt: server.createdAt,
    updatedAt: server.updatedAt,
  }))
  try {
    return cloneJson(decodeAgentMcpServers(projection))
  } catch {
    return []
  }
}

/** 损坏 store 的未知结构不应原样进入公开 FileSystem/导出；只返回正式 codec 可接受的字段。 */
export function sanitizeRules(value: unknown): AgentRule[] {
  try {
    return cloneJson(decodeAgentRules(value)) as AgentRule[]
  } catch {
    return []
  }
}

export function sanitizeSkills(value: unknown): AgentSkill[] {
  try {
    return cloneJson(decodeAgentSkills(value)) as AgentSkill[]
  } catch {
    return []
  }
}

export function sanitizeTasks(value: unknown): AgentTask[] {
  try {
    return cloneJson(decodeAgentTasks(value)) as AgentTask[]
  } catch {
    return []
  }
}

export function sanitizeAgentStorageValue(key: string, value: unknown): unknown {
  if (key === AGENT_SETTINGS_STORAGE_KEY) return sanitizeSettings(value)
  if (key === AGENT_WORKSPACES_STORAGE_KEY) return sanitizeWorkspaces(value)
  if (key === AGENT_SECRETS_STORAGE_KEY) return sanitizeSecrets(value)
  if (key === AGENT_MCP_STORAGE_KEY) return sanitizeMcp(value)
  if (key === AGENT_RULES_STORAGE_KEY) return sanitizeRules(value)
  if (key === AGENT_SKILLS_STORAGE_KEY) return sanitizeSkills(value)
  if (key === AGENT_TASKS_STORAGE_KEY) return sanitizeTasks(value)
  return cloneJson(value)
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label}必须是 JSON 数组`)
  return value
}

export function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label}必须是 JSON 对象`)
  return value
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key))
  if (extras.length) throw new Error(`${label}包含未知字段: ${extras.join(", ")}`)
}

function requireString(
  value: Record<string, unknown>,
  key: string,
  label: string,
  nonEmpty = false,
): string {
  const field = value[key]
  if (typeof field !== "string" || (nonEmpty && !field.trim())) {
    throw new Error(`${label}.${key}必须是${nonEmpty ? "非空" : ""}字符串`)
  }
  return field
}

function requireBoolean(value: Record<string, unknown>, key: string, label: string): boolean {
  const field = value[key]
  if (typeof field !== "boolean") throw new Error(`${label}.${key}必须是布尔值`)
  return field
}

function optionalBoolean(
  value: Record<string, unknown>,
  key: string,
  label: string,
): boolean | undefined {
  return value[key] === undefined ? undefined : requireBoolean(value, key, label)
}

function requireNumber(value: Record<string, unknown>, key: string, label: string): number {
  const field = value[key]
  if (typeof field !== "number" || !Number.isFinite(field) || field < 0) {
    throw new Error(`${label}.${key}必须是非负有限数`)
  }
  return field
}

function requireEnum<T extends string>(
  value: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  label: string,
): T {
  const field = value[key]
  if (typeof field !== "string" || !allowed.some((item) => item === field)) {
    throw new Error(`${label}.${key}枚举值无效`)
  }
  return field as T
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${label}必须是字符串数组`)
  }
  return value
}

function requireNullableStringArray(value: unknown, label: string): string[] | null {
  return value === null ? null : requireStringArray(value, label)
}

function assertUniqueRecordIds(values: readonly Record<string, unknown>[], label: string): void {
  const seen = new Set<string>()
  for (const [index, value] of values.entries()) {
    const id = requireString(value, "id", `${label}[${index}]`, true)
    if (seen.has(id)) throw new Error(`${label}包含重复 id: ${id}`)
    seen.add(id)
  }
}

export function decodeAgentSettingsPublic(value: unknown, current: AgentSettings): AgentSettings {
  const raw = requireRecord(value, "Agent 全局设置")
  assertOnlyKeys(
    raw,
    [
      "baseURL",
      "model",
      // 明文永不落库；允许旧导出/手写文件携带后安全丢弃，避免把 secret 当未知字段回显。
      "apiKey",
      "includeHomeContext",
      "defaultAgentMode",
      "approvalPolicy",
    ],
    "Agent 全局设置",
  )
  // 缺省字段仍按既有 partial 配置语义补默认值；但显式出现的已知字段必须先按
  // 原始类型校验，不能在公开投影中被丢弃后静默变成默认设置。
  if (raw.baseURL !== undefined) requireString(raw, "baseURL", "Agent 全局设置")
  if (raw.model !== undefined) requireString(raw, "model", "Agent 全局设置")
  if (raw.apiKey !== undefined) requireString(raw, "apiKey", "Agent 全局设置")
  if (raw.includeHomeContext !== undefined) {
    requireBoolean(raw, "includeHomeContext", "Agent 全局设置")
  }
  if (raw.defaultAgentMode !== undefined) {
    requireBoolean(raw, "defaultAgentMode", "Agent 全局设置")
  }
  if (raw.approvalPolicy !== undefined) {
    requireEnum(raw, "approvalPolicy", ["confirm", "auto"] as const, "Agent 全局设置")
  }
  const input = requireRecord(sanitizeSettings(value), "Agent 全局设置")
  const baseURL = input.baseURL === undefined ? DEFAULT_SETTINGS.baseURL : input.baseURL
  const model = input.model === undefined ? DEFAULT_SETTINGS.model : input.model
  const includeHomeContext =
    input.includeHomeContext === undefined
      ? DEFAULT_SETTINGS.includeHomeContext
      : input.includeHomeContext
  const defaultAgentMode =
    input.defaultAgentMode === undefined
      ? DEFAULT_SETTINGS.defaultAgentMode
      : input.defaultAgentMode
  const approvalPolicy =
    input.approvalPolicy === undefined ? DEFAULT_SETTINGS.approvalPolicy : input.approvalPolicy
  if (
    typeof baseURL !== "string" ||
    typeof model !== "string" ||
    typeof includeHomeContext !== "boolean" ||
    typeof defaultAgentMode !== "boolean" ||
    (approvalPolicy !== "confirm" && approvalPolicy !== "auto")
  ) {
    throw new Error("Agent 全局设置字段格式无效")
  }
  return {
    baseURL,
    model,
    includeHomeContext,
    defaultAgentMode,
    approvalPolicy,
    apiKey:
      httpEndpoint(baseURL) !== null && httpEndpoint(baseURL) === httpEndpoint(current.baseURL)
        ? current.apiKey
        : "",
  }
}

export function decodeAgentRules(value: unknown): AgentRule[] {
  const records = requireArray(value, "Agent 规则").map((item, index) =>
    requireRecord(item, `Agent 规则[${index}]`),
  )
  assertUniqueRecordIds(records, "Agent 规则")
  return records.map((record, index) => {
    const label = `Agent 规则[${index}]`
    assertOnlyKeys(
      record,
      [
        "id",
        "name",
        "description",
        "activation",
        "glob",
        "body",
        "scope",
        "enabled",
        "createdAt",
        "updatedAt",
      ],
      label,
    )
    return {
      id: requireString(record, "id", label, true),
      name: requireString(record, "name", label),
      description: requireString(record, "description", label),
      activation: requireEnum(record, "activation", ["always", "smart", "glob", "manual"], label),
      glob: requireString(record, "glob", label),
      body: requireString(record, "body", label),
      scope: requireEnum(record, "scope", ["global", "workspace"], label),
      enabled: requireBoolean(record, "enabled", label),
      createdAt: requireNumber(record, "createdAt", label),
      updatedAt: requireNumber(record, "updatedAt", label),
    }
  })
}

export function decodeAgentSkills(value: unknown): AgentSkill[] {
  const records = requireArray(value, "Agent 技能").map((item, index) =>
    requireRecord(item, `Agent 技能[${index}]`),
  )
  assertUniqueRecordIds(records, "Agent 技能")
  return records.map((record, index) => {
    const label = `Agent 技能[${index}]`
    assertOnlyKeys(
      record,
      [
        "id",
        "label",
        "hint",
        "prompt",
        "needsActiveNode",
        "agentMode",
        "builtin",
        "enabled",
        "invocation",
      ],
      label,
    )
    const invocation =
      record.invocation === undefined
        ? undefined
        : requireEnum(record, "invocation", ["auto", "manual"], label)
    return {
      id: requireString(record, "id", label, true),
      label: requireString(record, "label", label),
      hint: requireString(record, "hint", label),
      prompt: requireString(record, "prompt", label),
      needsActiveNode: optionalBoolean(record, "needsActiveNode", label),
      agentMode: optionalBoolean(record, "agentMode", label),
      builtin: optionalBoolean(record, "builtin", label),
      enabled: optionalBoolean(record, "enabled", label),
      invocation,
    }
  })
}

function decodeBindings(value: unknown, label: string): McpEnvVar[] {
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  return value.map((item, index) => {
    const bindingLabel = `${label}[${index}]`
    const binding = requireRecord(item, bindingLabel)
    assertOnlyKeys(binding, ["key", "value"], bindingLabel)
    return {
      key: requireString(binding, "key", bindingLabel),
      value: requireString(binding, "value", bindingLabel),
    }
  })
}

export function decodeAgentMcpServers(value: unknown): McpServer[] {
  const records = requireArray(value, "Agent MCP").map((item, index) =>
    requireRecord(item, `Agent MCP[${index}]`),
  )
  assertUniqueRecordIds(records, "Agent MCP")
  return records.map((record, index) => {
    const label = `Agent MCP[${index}]`
    assertOnlyKeys(
      record,
      [
        "id",
        "name",
        "transport",
        "command",
        "args",
        "url",
        "env",
        "headers",
        "auth",
        "enabled",
        "builtin",
        "createdAt",
        "updatedAt",
      ],
      label,
    )
    const transport = requireEnum(record, "transport", ["loopback", "stdio", "sse", "http"], label)
    const url = requireString(record, "url", label)
    if (isRemoteTransport(transport) && url && httpEndpoint(url) === null) {
      throw new Error(`${label}.url必须是 HTTP(S) URL`)
    }
    return {
      id: requireString(record, "id", label, true),
      name: requireString(record, "name", label),
      transport,
      command: requireString(record, "command", label),
      args: requireString(record, "args", label),
      url,
      env: decodeBindings(record.env, `${label}.env`),
      headers: decodeBindings(record.headers, `${label}.headers`),
      auth: requireEnum(record, "auth", ["none", "oauth"], label),
      enabled: requireBoolean(record, "enabled", label),
      builtin: requireBoolean(record, "builtin", label),
      createdAt: requireNumber(record, "createdAt", label),
      updatedAt: requireNumber(record, "updatedAt", label),
    }
  })
}

export function decodeAgentTasks(value: unknown): AgentTask[] {
  const records = requireArray(value, "Agent 任务").map((item, index) =>
    requireRecord(item, `Agent 任务[${index}]`),
  )
  assertUniqueRecordIds(records, "Agent 任务")
  return records.map((record, index) => {
    const label = `Agent 任务[${index}]`
    assertOnlyKeys(
      record,
      ["id", "workspaceId", "status", "starred", "createdAt", "updatedAt"],
      label,
    )
    return {
      id: requireString(record, "id", label, true),
      workspaceId: requireString(record, "workspaceId", label, true),
      status: requireEnum(record, "status", ["active", "running", "done", "failed"], label),
      starred: requireBoolean(record, "starred", label),
      createdAt: requireNumber(record, "createdAt", label),
      updatedAt: requireNumber(record, "updatedAt", label),
    }
  })
}

function nullableString(value: unknown, label: string): string | null {
  if (value !== null && typeof value !== "string") throw new Error(`${label}必须是字符串或 null`)
  return value
}

const CONFIGURABLE_PERMISSIONS = new Set<string>(AGENT_CONFIGURABLE_PERMISSIONS)

function isConfigurablePermission(value: string): value is Permission {
  return CONFIGURABLE_PERMISSIONS.has(value)
}

function decodeWorkspace(value: unknown, index: number, allowModelApiKey: boolean): AgentWorkspace {
  const label = `Agent 工作区.workspaces[${index}]`
  const workspace = requireRecord(value, label)
  assertOnlyKeys(
    workspace,
    ["id", "name", "data", "capabilities", "rules", "prompt", "model", "createdAt", "updatedAt"],
    label,
  )

  const dataLabel = `${label}.data`
  const data = requireRecord(workspace.data, dataLabel)
  assertOnlyKeys(data, ["includeHome", "home", "dirNodeId", "osDir"], dataLabel)
  const homeLabel = `${dataLabel}.home`
  const home = requireRecord(data.home, homeLabel)
  assertOnlyKeys(home, ["notes", "subscriptions", "bookmarks", "folders", "files"], homeLabel)

  const capabilitiesLabel = `${label}.capabilities`
  const capabilities = requireRecord(workspace.capabilities, capabilitiesLabel)
  assertOnlyKeys(
    capabilities,
    ["permissions", "toolAllowlist", "skillIds", "appIds"],
    capabilitiesLabel,
  )
  const permissions = requireStringArray(
    capabilities.permissions,
    `${capabilitiesLabel}.permissions`,
  )
  if (permissions.some((permission) => !isConfigurablePermission(permission))) {
    throw new Error(`${capabilitiesLabel}.permissions包含未知权限`)
  }

  const rulesLabel = `${label}.rules`
  const rules = requireRecord(workspace.rules, rulesLabel)
  assertOnlyKeys(rules, ["ruleIds"], rulesLabel)
  const promptLabel = `${label}.prompt`
  const prompt = requireRecord(workspace.prompt, promptLabel)
  assertOnlyKeys(prompt, ["instructions", "template", "precise", "override"], promptLabel)
  const modelLabel = `${label}.model`
  const model = requireRecord(workspace.model, modelLabel)
  assertOnlyKeys(
    model,
    allowModelApiKey
      ? ["useGlobal", "baseURL", "model", "apiKey"]
      : ["useGlobal", "baseURL", "model"],
    modelLabel,
  )
  const apiKey =
    allowModelApiKey && model.apiKey !== undefined ? requireString(model, "apiKey", modelLabel) : ""

  return {
    id: requireString(workspace, "id", label, true),
    name: requireString(workspace, "name", label),
    data: {
      includeHome: requireBoolean(data, "includeHome", dataLabel),
      home: {
        notes: requireBoolean(home, "notes", homeLabel),
        subscriptions: requireBoolean(home, "subscriptions", homeLabel),
        bookmarks: requireBoolean(home, "bookmarks", homeLabel),
        folders: requireBoolean(home, "folders", homeLabel),
        files: requireBoolean(home, "files", homeLabel),
      },
      dirNodeId: nullableString(data.dirNodeId, `${dataLabel}.dirNodeId`),
      osDir: nullableString(data.osDir, `${dataLabel}.osDir`),
    },
    capabilities: {
      permissions: permissions.filter(isConfigurablePermission),
      toolAllowlist: requireNullableStringArray(
        capabilities.toolAllowlist,
        `${capabilitiesLabel}.toolAllowlist`,
      ),
      skillIds: requireNullableStringArray(capabilities.skillIds, `${capabilitiesLabel}.skillIds`),
      appIds: requireNullableStringArray(capabilities.appIds, `${capabilitiesLabel}.appIds`),
    },
    rules: { ruleIds: requireStringArray(rules.ruleIds, `${rulesLabel}.ruleIds`) },
    prompt: {
      instructions: requireString(prompt, "instructions", promptLabel),
      template: requireString(prompt, "template", promptLabel),
      precise: requireBoolean(prompt, "precise", promptLabel),
      override: requireString(prompt, "override", promptLabel),
    },
    model: {
      useGlobal: requireBoolean(model, "useGlobal", modelLabel),
      baseURL: requireString(model, "baseURL", modelLabel),
      model: requireString(model, "model", modelLabel),
      apiKey,
    },
    createdAt: requireNumber(workspace, "createdAt", label),
    updatedAt: requireNumber(workspace, "updatedAt", label),
  }
}

export function decodeAgentWorkspacesState(
  value: unknown,
  allowModelApiKey = false,
): WorkspacesState {
  const record = requireRecord(value, "Agent 工作区")
  assertOnlyKeys(record, ["workspaces", "activeId"], "Agent 工作区")
  if (!Array.isArray(record.workspaces) || record.workspaces.length === 0) {
    throw new Error("Agent 工作区.workspaces必须是非空数组")
  }
  const workspaces = record.workspaces.map((workspace, index) =>
    decodeWorkspace(workspace, index, allowModelApiKey),
  )
  const seen = new Set<string>()
  for (const workspace of workspaces) {
    if (seen.has(workspace.id)) {
      throw new Error(`Agent 工作区.workspaces包含重复 id: ${workspace.id}`)
    }
    seen.add(workspace.id)
  }
  const activeId = requireString(record, "activeId", "Agent 工作区", true)
  if (!workspaces.some((workspace) => workspace.id === activeId)) {
    throw new Error("Agent 工作区.activeId必须引用现有工作区")
  }
  return { workspaces, activeId }
}
