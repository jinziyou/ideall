import {
  fileRefKey,
  isFileRef,
  sameFileRef,
  type FileRef,
  type IdeallFile,
} from "@protocol/file-system"
import { ThreadTaskConflictError } from "@protocol/files"
import type {
  DirectoryPage,
  FileAction,
  FileReadOptions,
  FileReadResult,
  FileSystemAccessContext,
  FileSystemProvider,
  FileSystemWatchEvent,
  FileSystemWatchHandle,
  FileWriteInput,
  ReadDirectoryOptions,
} from "@/filesystem/types"
import { paginateDirectoryItems } from "@/filesystem/provider-input"
import { FileSystemError } from "@/filesystem/types"
import { withFileWriteLock } from "@/filesystem/write-lock"
import { resourceFileRef } from "@/filesystem/resource-file-system"
import { sha256SemanticVersion } from "@/lib/semantic-version"
import {
  AGENT_CONFIG_FILE_SYSTEM_ID as BUILTIN_AGENT_CONFIG_FILE_SYSTEM_ID,
  AGENT_CONFIG_ROOT_MEDIA_TYPE,
  AGENT_CONFIG_ROOT_REF,
  AGENT_SETTINGS_FILE_REF,
  AGENT_SETTINGS_MEDIA_TYPE,
  AGENT_TASKS_FILE_REF,
  AGENT_TASKS_MEDIA_TYPE,
  AGENT_WORKSPACES_FILE_REF,
  AGENT_WORKSPACES_MEDIA_TYPE,
} from "@/filesystem/builtin-app-roots"
import {
  AGENT_DATA_SPEC,
  AGENT_PUBLIC_CONFIG_SECTIONS,
  AgentWorkspaceNotFoundError,
  activateAgentWorkspace,
  agentSettingsCredentialConfiguredSnapshot,
  agentSettingsCredentialRevisionSnapshot,
  agentWorkspacesRevisionSnapshot,
  createAgentWorkspace,
  deleteAgentSettingsApiKey,
  prepareAgentPublicConfigSection,
  readAgentPublicConfigSection,
  readAgentSettingsCredentialConfigured,
  sanitizeAgentPublicConfigSection,
  subscribeAgentPublicConfigSection,
  writeAgentPublicConfigFileSection,
  writeAgentSettingsApiKey,
  type AgentPublicConfigSectionId,
} from "./lib/agent-data-port"
import {
  AGENT_WORKSPACE_ACTIVATE_ACTION,
  AGENT_WORKSPACE_CREATE_ACTION,
  decodeAgentTasksDocument,
  decodeAgentWorkspaceActivateInput,
  decodeAgentWorkspaceActivateResult,
  decodeAgentWorkspaceCreateInput,
  decodeAgentWorkspaceCreateResult,
  type AgentTaskSummary,
  type AgentWorkspaceActivateResult,
  type AgentWorkspaceCreateResult,
} from "./agent-management-file-contract"
import {
  AGENT_SETTINGS_ACP_DETECT_ACTION,
  AGENT_SETTINGS_ACP_PROBE_ACTION,
  AGENT_SETTINGS_ACP_READ_ACTION,
  AGENT_SETTINGS_ACP_WRITE_ACTION,
  AGENT_SETTINGS_CLEAR_API_KEY_ACTION,
  AGENT_SETTINGS_CREDENTIAL_STATUS_ACTION,
  AGENT_SETTINGS_SET_API_KEY_ACTION,
  decodeAgentAcpProbeInput,
  decodeAgentAcpProbeResult,
  decodeAgentAcpSettings,
  decodeAgentDetectedAcpAgents,
  decodeAgentSettingsSetApiKeyInput,
  type AgentAcpProbeResult,
  type AgentAcpSettings,
  type AgentDetectedAcpAgent,
  type AgentExternalAcpConfig,
  type AgentSettingsCredentialStatus,
} from "./agent-settings-file-contract"
import { decodeAgentMcpServers, decodeAgentTasks } from "./lib/agent-config-codecs"
import type { ExternalMcpTransport, McpFailureKind } from "./lib/agent-mcp-diagnostics"
import {
  createMcpServer as createRegisteredMcpServer,
  getMcpServers,
  type McpServer,
} from "./lib/agent-mcp-registry"
import {
  subscribeAgentImportInvalidation,
  withAgentSettingsFileWriteLock,
} from "./agent-settings-write-adapter"
import { getAcpSettings, setAcpSettings, subscribeAcpSettings } from "./lib/acp/acp-settings"

export const AGENT_CONFIG_FILE_SYSTEM_ID = BUILTIN_AGENT_CONFIG_FILE_SYSTEM_ID
export const AGENT_CONFIG_MEDIA_TYPE = "application/json"
export const AGENT_CONFIG_READ_PERMISSION = "agent.config:read"
export const AGENT_CONFIG_WRITE_PERMISSION = "agent.config:write"
/** MCP 的 args/URL 凭据位不会出现在公开 JSON；新建必须走仅写动作避免脱敏回读丢值。 */
export const AGENT_MCP_CREATE_ACTION = "mcp.create"
export const AGENT_MCP_PROBE_ACTION = "mcp.probe"

export type AgentMcpCreateResult = Readonly<{ serverId: string }>
export type AgentMcpProbeResult = Readonly<{
  ok: boolean
  transport?: ExternalMcpTransport
  checkedAt?: number
  durationMs?: number
  toolCount?: number
  tools?: string[]
  error?: string
  errorKind?: McpFailureKind
  errorCode?: string
}>

const SAFE_MCP_PROBE_FAILURES: Readonly<
  Record<string, Readonly<{ kind: McpFailureKind; message: string }>>
> = {
  "authentication-required": { kind: "authentication", message: "认证失败或尚未授权" },
  "operation-timeout": { kind: "timeout", message: "MCP 连接或调用超时" },
  "transport-unsupported": { kind: "unsupported", message: "当前平台不支持该 MCP 传输" },
  "invalid-configuration": { kind: "configuration", message: "MCP 连接配置无效" },
  "protocol-error": { kind: "protocol", message: "服务响应不符合 MCP 协议" },
  "service-unavailable": { kind: "unavailable", message: "MCP 服务不可达" },
  "transport-error": { kind: "transport", message: "MCP 传输失败" },
  "unknown-error": { kind: "unknown", message: "MCP 操作失败" },
}
const MCP_FAILURE_KINDS = new Set<McpFailureKind>([
  "configuration",
  "authentication",
  "timeout",
  "unsupported",
  "protocol",
  "unavailable",
  "transport",
  "unknown",
])

export const agentConfigRootRef: FileRef = AGENT_CONFIG_ROOT_REF

export function agentConfigFileRef(section: AgentPublicConfigSectionId): FileRef {
  if (section === "settings") return AGENT_SETTINGS_FILE_REF
  if (section === "workspaces") return AGENT_WORKSPACES_FILE_REF
  if (section === "tasks") return AGENT_TASKS_FILE_REF
  return {
    fileSystemId: AGENT_CONFIG_FILE_SYSTEM_ID,
    fileId: `config:${section}`,
  }
}

function sectionIdFromRef(ref: FileRef): AgentPublicConfigSectionId | null {
  if (ref.fileSystemId !== AGENT_CONFIG_FILE_SYSTEM_ID || !ref.fileId.startsWith("config:")) {
    return null
  }
  const candidate = ref.fileId.slice("config:".length)
  return AGENT_PUBLIC_CONFIG_SECTIONS.some((section) => section.id === candidate)
    ? (candidate as AgentPublicConfigSectionId)
    : null
}

const SOURCE = { kind: "app", id: "agent", label: "AI 智能体" } as const

type AgentManagementSurface = "settings" | "spaces" | "tasks"

function managementSurface(section: AgentPublicConfigSectionId): AgentManagementSurface | null {
  if (section === "settings") return "settings"
  if (section === "workspaces") return "spaces"
  if (section === "tasks") return "tasks"
  return null
}

function mediaTypeForSection(section: AgentPublicConfigSectionId): string {
  if (section === "settings") return AGENT_SETTINGS_MEDIA_TYPE
  if (section === "workspaces") return AGENT_WORKSPACES_MEDIA_TYPE
  if (section === "tasks") return AGENT_TASKS_MEDIA_TYPE
  return AGENT_CONFIG_MEDIA_TYPE
}

export type AgentConfigFileSystemDeps = {
  read(section: AgentPublicConfigSectionId): unknown
  /** 在读取同步快照前完成异步 Storage 水合；tasks 同时影响 workspaces.taskCount。 */
  prepare?(section: AgentPublicConfigSectionId): void | Promise<void>
  write(section: AgentPublicConfigSectionId, value: unknown): void | Promise<void>
  subscribe(section: AgentPublicConfigSectionId, listener: () => void): () => void
  settingsCredentialConfigured?(): boolean
  /** 不含凭据内容；每次成功 set/clear 后单调推进。 */
  settingsCredentialRevision?(): string
  /** 不含凭据内容；每次 workspace 耐久提交后单调推进。 */
  workspaceRevision?(): string
  readSettingsCredentialConfigured?(): boolean | Promise<boolean>
  writeSettingsApiKey?(apiKey: string): void | Promise<void>
  deleteSettingsApiKey?(): void | Promise<void>
  readAcpSettings?(): AgentAcpSettings
  writeAcpSettings?(settings: AgentAcpSettings): void | Promise<void>
  subscribeAcpSettings?(listener: () => void): () => void
  detectAcpAgents?(): AgentDetectedAcpAgent[] | Promise<AgentDetectedAcpAgent[]>
  probeAcpAgent?(config: AgentExternalAcpConfig): AgentAcpProbeResult | Promise<AgentAcpProbeResult>
  createWorkspace?(name?: string): AgentWorkspaceCreateResult | Promise<AgentWorkspaceCreateResult>
  activateWorkspace?(
    workspaceId: string,
  ): AgentWorkspaceActivateResult | Promise<AgentWorkspaceActivateResult>
  createMcpServer?(server: Partial<McpServer>): McpServer | Promise<McpServer>
  probeMcpServer?(
    serverId: string,
  ): AgentMcpProbeResult | null | Promise<AgentMcpProbeResult | null>
}

const defaultDeps: AgentConfigFileSystemDeps = {
  read: readAgentPublicConfigSection,
  prepare: prepareAgentPublicConfigSection,
  write: writeAgentPublicConfigFileSection,
  subscribe: subscribeAgentPublicConfigSection,
  settingsCredentialConfigured: agentSettingsCredentialConfiguredSnapshot,
  settingsCredentialRevision: agentSettingsCredentialRevisionSnapshot,
  workspaceRevision: agentWorkspacesRevisionSnapshot,
  readSettingsCredentialConfigured: readAgentSettingsCredentialConfigured,
  writeSettingsApiKey: writeAgentSettingsApiKey,
  deleteSettingsApiKey: deleteAgentSettingsApiKey,
  readAcpSettings: getAcpSettings,
  writeAcpSettings: setAcpSettings,
  subscribeAcpSettings,
  async detectAcpAgents() {
    const { detectAgents } = await import("./lib/acp/acp-detect")
    return detectAgents()
  },
  async probeAcpAgent(config) {
    const { probeExternalAcpAgent } = await import("./lib/acp/acp-client")
    return probeExternalAcpAgent(config)
  },
  createWorkspace: createAgentWorkspace,
  activateWorkspace: activateAgentWorkspace,
  createMcpServer: createRegisteredMcpServer,
  async probeMcpServer(serverId) {
    const server = getMcpServers().find((candidate) => candidate.id === serverId)
    if (!server) return null
    // agent-mcp 反向依赖本模块的权限常量；动态加载避免初始化环，同时让外部传输留在懒 chunk。
    const { probeMcpServer } = await import("./lib/agent-mcp")
    return probeMcpServer(server)
  },
}

function withAgentConfigFileWriteLock<T>(
  ref: FileRef,
  section: AgentPublicConfigSectionId,
  operation: () => T | Promise<T>,
): Promise<T> {
  if (section === "settings") return withAgentSettingsFileWriteLock(operation)
  if (section === "workspaces") {
    // workspaces 版本依赖 tasks；按全量 importer 的 FileRef 顺序串行两个 provider 写入口。
    return withFileWriteLock(AGENT_TASKS_FILE_REF, () => withFileWriteLock(ref, operation))
  }
  return withFileWriteLock(ref, operation)
}

/**
 * tasks/workspaces 的读取 prepare 可能迁移旧 task Storage 或刷新同步缓存，因此它不是纯读。
 * workspace 快照同时依赖 task 与 workspace revision，必须按 tasks→workspaces 固定顺序锁住
 * prepare 与随后的语义快照；tasks 自身仍只需要 tasks 锁。
 * mutation 路径已经在 withAgentConfigFileWriteLock 内，只能继续调用 raw prepare，禁止重入。
 */
function withAgentConfigPreparedRead<T>(
  section: AgentPublicConfigSectionId,
  operation: () => Promise<T>,
): Promise<T> {
  if (section === "tasks") return withFileWriteLock(AGENT_TASKS_FILE_REF, operation)
  if (section === "workspaces") {
    return withFileWriteLock(AGENT_TASKS_FILE_REF, () =>
      withFileWriteLock(AGENT_WORKSPACES_FILE_REF, operation),
    )
  }
  return operation()
}

type ConfigSnapshot = {
  value: unknown
  text: string
  bytes: Uint8Array
  version: string
}

function agentTaskThreadRef(taskId: string): FileRef {
  return resourceFileRef({ scheme: "node", kind: "thread", id: taskId })
}

function projectTasksValue(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item
    const task = item as Record<string, unknown>
    return typeof task.id === "string" ? { ...task, threadRef: agentTaskThreadRef(task.id) } : task
  })
}

function taskSummaries(value: unknown): readonly AgentTaskSummary[] {
  return decodeAgentTasksDocument(projectTasksValue(value))
}

function taskCountsByWorkspace(tasks: readonly AgentTaskSummary[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>()
  for (const task of tasks) {
    counts.set(task.workspaceId, (counts.get(task.workspaceId) ?? 0) + 1)
  }
  return counts
}

function compareTaskDirectoryOrder(left: AgentTaskSummary, right: AgentTaskSummary): number {
  if (left.updatedAt !== right.updatedAt) return right.updatedAt - left.updatedAt
  if (left.id < right.id) return -1
  if (left.id > right.id) return 1
  return 0
}

function projectWorkspacesValue(value: unknown, tasks: readonly AgentTaskSummary[]): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value
  const document = value as Record<string, unknown>
  if (!Array.isArray(document.workspaces)) return value
  const counts = taskCountsByWorkspace(tasks)
  return {
    ...document,
    workspaces: document.workspaces.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item
      const workspace = item as Record<string, unknown>
      return {
        ...workspace,
        taskCount: typeof workspace.id === "string" ? (counts.get(workspace.id) ?? 0) : 0,
      }
    }),
  }
}

function stripTaskThreadRefs(ref: FileRef, value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item
    const { threadRef, ...task } = item as Record<string, unknown>
    if (threadRef === undefined) return task
    if (
      typeof task.id !== "string" ||
      !isFileRef(threadRef) ||
      !sameFileRef(threadRef, agentTaskThreadRef(task.id))
    ) {
      throw new FileSystemError(
        "invalid-input",
        "Task thread reference does not match its stable task identity",
        ref,
      )
    }
    return task
  })
}

function currentTaskSummaries(deps: AgentConfigFileSystemDeps): readonly AgentTaskSummary[] {
  return taskSummaries(currentTasksValue(deps))
}

function currentTasksValue(deps: AgentConfigFileSystemDeps): unknown {
  return projectTasksValue(sanitizeAgentPublicConfigSection("tasks", deps.read("tasks")))
}

function stripWorkspaceTaskCounts(
  ref: FileRef,
  value: unknown,
  deps: AgentConfigFileSystemDeps,
): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value
  const document = value as Record<string, unknown>
  if (!Array.isArray(document.workspaces)) return value
  const counts = taskCountsByWorkspace(currentTaskSummaries(deps))
  return {
    ...document,
    workspaces: document.workspaces.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item
      const { taskCount, ...workspace } = item as Record<string, unknown>
      if (taskCount === undefined) return workspace
      if (
        typeof workspace.id !== "string" ||
        typeof taskCount !== "number" ||
        !Number.isSafeInteger(taskCount) ||
        taskCount < 0 ||
        taskCount !== (counts.get(workspace.id) ?? 0)
      ) {
        throw new FileSystemError(
          "invalid-input",
          "Workspace taskCount does not match the current derived task count",
          ref,
        )
      }
      return workspace
    }),
  }
}

const TASK_DIRECTORY_CURSOR_PREFIX = "agent-tasks-v1:"

function taskDirectoryCursor(version: string, offset: string): string {
  return `${TASK_DIRECTORY_CURSOR_PREFIX}${encodeURIComponent(version)}:${offset}`
}

function taskDirectoryOffset(
  ref: FileRef,
  cursor: string | undefined,
  currentVersion: string,
): string | undefined {
  if (cursor === undefined) return undefined
  if (!cursor.startsWith(TASK_DIRECTORY_CURSOR_PREFIX) || cursor.length > 512) {
    throw new FileSystemError("invalid-input", "Invalid Agent tasks directory cursor", ref)
  }
  const payload = cursor.slice(TASK_DIRECTORY_CURSOR_PREFIX.length)
  const separator = payload.lastIndexOf(":")
  if (separator <= 0 || separator === payload.length - 1) {
    throw new FileSystemError("invalid-input", "Invalid Agent tasks directory cursor", ref)
  }
  const encodedVersion = payload.slice(0, separator)
  const offset = payload.slice(separator + 1)
  let version: string
  try {
    version = decodeURIComponent(encodedVersion)
  } catch {
    throw new FileSystemError("invalid-input", "Invalid Agent tasks directory cursor", ref)
  }
  const parsedOffset = Number(offset)
  if (
    encodeURIComponent(version) !== encodedVersion ||
    !/^(0|[1-9]\d*)$/.test(offset) ||
    !Number.isSafeInteger(parsedOffset)
  ) {
    throw new FileSystemError("invalid-input", "Invalid Agent tasks directory cursor", ref)
  }
  if (version !== currentVersion) {
    throw new FileSystemError("conflict", "Agent tasks changed during directory pagination", ref)
  }
  return offset
}

function storageSectionValue(
  ref: FileRef,
  section: AgentPublicConfigSectionId,
  value: unknown,
  deps: AgentConfigFileSystemDeps,
): unknown {
  if (section === "tasks") return decodeAgentTasks(stripTaskThreadRefs(ref, value))
  if (section === "workspaces") return stripWorkspaceTaskCounts(ref, value, deps)
  return value
}

async function snapshot(
  section: AgentPublicConfigSectionId,
  deps: AgentConfigFileSystemDeps,
): Promise<ConfigSnapshot> {
  const sanitized = sanitizeAgentPublicConfigSection(section, deps.read(section))
  const taskDependency = section === "workspaces" ? currentTasksValue(deps) : null
  const dependentTaskSummaries = taskDependency === null ? null : taskSummaries(taskDependency)
  const value =
    section === "tasks"
      ? projectTasksValue(sanitized)
      : section === "workspaces" && dependentTaskSummaries
        ? projectWorkspacesValue(sanitized, dependentTaskSummaries)
        : sanitized
  const text = JSON.stringify(value, null, 2) ?? "null"
  const bytes = new TextEncoder().encode(text)
  const semanticSnapshot = JSON.stringify({
    section,
    content: text,
    // taskCount 之外的任务变化也必须使 workspaces 的乐观版本失效。
    taskDependency: taskDependency === null ? null : JSON.stringify(taskDependency),
    // 凭据存在性与不透明 mutation revision 都参与失效；不携带凭据内容。
    settingsCredentialConfigured:
      section === "settings" && deps.settingsCredentialConfigured?.() === true,
    settingsCredentialVersion:
      section === "settings" ? (deps.settingsCredentialRevision?.() ?? "0") : null,
    // ACP 命令属于设备运行配置，不进入 settings.json 正文；其语义仍参与版本/CAS 与 watch。
    settingsAcp:
      section === "settings" && deps.readAcpSettings
        ? decodeAgentAcpSettings(deps.readAcpSettings())
        : null,
    // 公开正文未变化的隐藏凭据变更和 ABA 也必须使旧 workspace CAS 失效。
    workspaceVersion: section === "workspaces" ? (deps.workspaceRevision?.() ?? "0") : null,
  })
  return {
    value,
    text,
    bytes,
    version: await sha256SemanticVersion("agent-config-v2", semanticSnapshot),
  }
}

async function configFile(
  sectionId: AgentPublicConfigSectionId,
  deps: AgentConfigFileSystemDeps,
  includeContentMetadata = true,
): Promise<IdeallFile> {
  const definition = AGENT_PUBLIC_CONFIG_SECTIONS.find((section) => section.id === sectionId)!
  const current = includeContentMetadata ? await snapshot(sectionId, deps) : null
  const surface = managementSurface(sectionId)
  return {
    ref: agentConfigFileRef(sectionId),
    kind: "file",
    name: definition.fileName,
    mediaType: mediaTypeForSection(sectionId),
    capabilities: [
      ...(sectionId === "tasks" ? ["read-directory"] : []),
      "read",
      "write",
      "actions",
      "watch",
      "standalone-window",
      AGENT_CONFIG_READ_PERMISSION,
      AGENT_CONFIG_WRITE_PERMISSION,
    ],
    source: SOURCE,
    size: current?.bytes.byteLength,
    version: current?.version,
    properties: {
      configSection: sectionId,
      label: definition.label,
      dataKind: AGENT_DATA_SPEC.dataKind,
      dataVersion: AGENT_DATA_SPEC.dataVersion,
      publicConfig: true,
      ...(surface ? { agentManagementSurface: surface } : {}),
    },
  }
}

function hasPermission(
  ref: FileRef,
  ctx: FileSystemAccessContext,
  permission:
    | "fs:read"
    | typeof AGENT_CONFIG_READ_PERMISSION
    | typeof AGENT_CONFIG_WRITE_PERMISSION,
): boolean {
  return (
    ctx.actor === "ui" ||
    (ctx.actor === "engine" && ctx.activeFile != null && sameFileRef(ref, ctx.activeFile)) ||
    ctx.permissions.includes(permission)
  )
}

function assertAccess(
  ref: FileRef,
  ctx: FileSystemAccessContext,
  intent: "metadata" | "directory" | "content" | "write" | "action" | "watch",
  permission:
    | "fs:read"
    | typeof AGENT_CONFIG_READ_PERMISSION
    | typeof AGENT_CONFIG_WRITE_PERMISSION,
): void {
  if (ctx.intent !== intent) {
    throw new FileSystemError(
      "permission-denied",
      `The ${ctx.actor} actor requires ${intent} intent`,
      ref,
    )
  }
  if (hasPermission(ref, ctx, permission)) return
  throw new FileSystemError("permission-denied", `Missing ${permission} permission`, ref)
}

function readRange(ref: FileRef, bytes: Uint8Array, options: FileReadOptions): Uint8Array {
  const range = options.range
  if (!range) return bytes
  const end = range.end ?? bytes.byteLength
  if (
    !Number.isSafeInteger(range.start) ||
    range.start < 0 ||
    !Number.isSafeInteger(end) ||
    end < range.start
  ) {
    throw new FileSystemError("invalid-input", "Invalid Agent config read range", ref)
  }
  return bytes.slice(range.start, end)
}

async function parseWriteData(ref: FileRef, data: unknown): Promise<unknown> {
  if (typeof data === "string") {
    try {
      return JSON.parse(data) as unknown
    } catch {
      throw new FileSystemError("invalid-input", "Agent config must be valid JSON", ref)
    }
  }
  if (data instanceof Uint8Array) {
    return parseWriteData(ref, new TextDecoder().decode(data))
  }
  if (data instanceof ArrayBuffer) {
    return parseWriteData(ref, new TextDecoder().decode(new Uint8Array(data)))
  }
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return parseWriteData(ref, await data.text())
  }
  if (data !== null && typeof data === "object") return data
  throw new FileSystemError("invalid-input", "Agent config must be JSON data", ref)
}

function assertExpectedVersion(
  ref: FileRef,
  expectedVersion: string | null | undefined,
  currentVersion: string,
): void {
  if (expectedVersion === undefined || expectedVersion === currentVersion) return
  throw new FileSystemError(
    "conflict",
    `Agent config changed (expected ${expectedVersion ?? "no version"}, current ${currentVersion})`,
    ref,
  )
}

function assertNoActionInput(ref: FileRef, input: unknown, label: string): void {
  if (input !== undefined) {
    throw new FileSystemError("invalid-input", `${label} does not accept input`, ref)
  }
}

function settingsApiKeyInput(ref: FileRef, input: unknown): string {
  try {
    return decodeAgentSettingsSetApiKeyInput(input).apiKey
  } catch {
    throw new FileSystemError("invalid-input", "Invalid API key input", ref)
  }
}

function acpSettingsInput(ref: FileRef, input: unknown): AgentAcpSettings {
  try {
    return decodeAgentAcpSettings(input)
  } catch {
    throw new FileSystemError("invalid-input", "Invalid ACP settings input", ref)
  }
}

function acpProbeInput(ref: FileRef, input: unknown): AgentExternalAcpConfig {
  try {
    return decodeAgentAcpProbeInput(input).externalAgent
  } catch {
    throw new FileSystemError("invalid-input", "Invalid ACP probe input", ref)
  }
}

function workspaceCreateName(ref: FileRef, input: unknown): string | undefined {
  try {
    return decodeAgentWorkspaceCreateInput(input).name
  } catch {
    throw new FileSystemError("invalid-input", "Invalid workspace creation input", ref)
  }
}

function workspaceActivateId(ref: FileRef, input: unknown): string {
  try {
    return decodeAgentWorkspaceActivateInput(input).workspaceId
  } catch {
    throw new FileSystemError("invalid-input", "Invalid workspace activation input", ref)
  }
}

function mcpCreateInput(ref: FileRef, input: unknown): Partial<McpServer> {
  try {
    const server = decodeAgentMcpServers([input])[0]
    if (!server || server.builtin || server.transport === "loopback") throw new Error()
    return {
      name: server.name,
      transport: server.transport,
      command: server.command,
      args: server.args,
      url: server.url,
      env: server.env,
      headers: server.headers,
      auth: server.auth,
      enabled: server.enabled,
      builtin: false,
    }
  } catch {
    throw new FileSystemError("invalid-input", "Invalid MCP server creation input", ref)
  }
}

function mcpCreateResult(ref: FileRef, value: unknown): AgentMcpCreateResult {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof (value as Partial<McpServer>).id !== "string" ||
    !(value as Partial<McpServer>).id?.trim()
  ) {
    throw new FileSystemError("unavailable", "MCP provider returned an invalid result", ref)
  }
  return { serverId: (value as McpServer).id }
}

function mcpProbeServerId(ref: FileRef, input: unknown): string {
  try {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error()
    const record = input as Record<string, unknown>
    const keys = Object.keys(record)
    const serverId = record.serverId
    if (
      keys.length !== 1 ||
      keys[0] !== "serverId" ||
      typeof serverId !== "string" ||
      !serverId.trim() ||
      serverId.length > 4_096
    ) {
      throw new Error()
    }
    return serverId
  } catch {
    throw new FileSystemError("invalid-input", "Invalid MCP probe input", ref)
  }
}

function mcpProbeResult(ref: FileRef, value: unknown): AgentMcpProbeResult {
  const invalid = () =>
    new FileSystemError("unavailable", "MCP probe returned an invalid result", ref)
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid()
    const result = value as Record<string, unknown>
    const allowed = new Set([
      "ok",
      "transport",
      "checkedAt",
      "durationMs",
      "toolCount",
      "tools",
      "error",
      "errorKind",
      "errorCode",
    ])
    for (const key of Object.keys(result)) {
      if (!allowed.has(key)) throw invalid()
    }
    if (typeof result.ok !== "boolean") throw invalid()
    const transport = result.transport
    if (
      transport !== undefined &&
      transport !== "stdio" &&
      transport !== "sse" &&
      transport !== "http"
    ) {
      throw invalid()
    }
    for (const field of ["checkedAt", "durationMs"] as const) {
      const item = result[field]
      if (item !== undefined && (!Number.isSafeInteger(item) || (item as number) < 0)) {
        throw invalid()
      }
    }
    if (
      result.toolCount !== undefined &&
      (typeof result.toolCount !== "number" ||
        !Number.isSafeInteger(result.toolCount) ||
        result.toolCount < 0)
    ) {
      throw invalid()
    }
    if (
      result.error !== undefined &&
      (typeof result.error !== "string" || result.error.length > 4_096)
    ) {
      throw invalid()
    }
    if (
      result.errorKind !== undefined &&
      (typeof result.errorKind !== "string" ||
        !MCP_FAILURE_KINDS.has(result.errorKind as McpFailureKind))
    ) {
      throw invalid()
    }
    if (
      result.errorCode !== undefined &&
      (typeof result.errorCode !== "string" || !/^[a-z][a-z0-9-]{0,127}$/.test(result.errorCode))
    ) {
      throw invalid()
    }
    if (
      result.error === undefined &&
      (result.errorKind !== undefined || result.errorCode !== undefined)
    ) {
      throw invalid()
    }
    let tools: string[] | undefined
    if (result.tools !== undefined) {
      if (!Array.isArray(result.tools) || result.tools.length > 64) throw invalid()
      tools = []
      for (let index = 0; index < result.tools.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(result.tools, index)) throw invalid()
        const tool = result.tools[index]
        if (typeof tool !== "string" || tool.length > 512) throw invalid()
        const cleaned = tool
          .replace(/[\u0000-\u001f\u007f]/g, " ")
          .replace(/\s+/g, " ")
          .trim()
        tools.push(
          cleaned
            ? cleaned.length > 128
              ? `${cleaned.slice(0, 127)}…`
              : cleaned
            : "external-tool",
        )
      }
    }
    const failure =
      typeof result.errorCode === "string" ? SAFE_MCP_PROBE_FAILURES[result.errorCode] : undefined
    if (failure && result.errorKind !== undefined && failure.kind !== result.errorKind)
      throw invalid()
    const failureMessage =
      result.errorCode === "service-unavailable" && transport === "stdio"
        ? "无法启动或连接本地 MCP 服务"
        : failure?.message
    return {
      ok: result.ok,
      ...(transport === undefined ? {} : { transport }),
      ...(result.checkedAt === undefined ? {} : { checkedAt: result.checkedAt as number }),
      ...(result.durationMs === undefined ? {} : { durationMs: result.durationMs as number }),
      ...(result.toolCount === undefined ? {} : { toolCount: result.toolCount as number }),
      ...(tools === undefined ? {} : { tools }),
      ...(result.error === undefined
        ? {}
        : failure
          ? {
              error: failureMessage!,
              errorKind: failure.kind,
              errorCode: result.errorCode as string,
            }
          : { error: "连接失败，请检查本机配置和服务状态" }),
    }
  } catch (error) {
    if (error instanceof FileSystemError) throw error
    throw invalid()
  }
}

function workspaceCreateResult(ref: FileRef, value: unknown): AgentWorkspaceCreateResult {
  try {
    return decodeAgentWorkspaceCreateResult(value)
  } catch {
    throw new FileSystemError("unavailable", "Workspace provider returned an invalid result", ref)
  }
}

function workspaceActivateResult(
  ref: FileRef,
  value: unknown,
  expectedWorkspaceId: string,
): AgentWorkspaceActivateResult {
  try {
    const result = decodeAgentWorkspaceActivateResult(value)
    if (result.workspaceId !== expectedWorkspaceId) throw new Error("Mismatched workspace identity")
    return result
  } catch {
    throw new FileSystemError("unavailable", "Workspace provider returned an invalid result", ref)
  }
}

function mutationError(ref: FileRef, label: string, error: unknown): FileSystemError {
  if (error instanceof FileSystemError && error.code === "not-found") {
    return new FileSystemError("not-found", "Agent workspace not found", ref)
  }
  if (error instanceof AgentWorkspaceNotFoundError) {
    return new FileSystemError("not-found", "Agent workspace not found", ref)
  }
  return new FileSystemError("unavailable", `${label} failed`, ref)
}

function credentialMutationError(ref: FileRef): FileSystemError {
  // 凭据后端异常可能包含调用参数；错误边界不回显原始 message。
  return new FileSystemError("offline", "Unable to persist AI credential", ref)
}

function sectionActions(section: AgentPublicConfigSectionId): FileAction[] {
  const actions: FileAction[] = [
    { id: "open", label: "打开", kind: "display", requires: ["fs:read"] },
  ]
  if (section === "settings") {
    actions.push(
      {
        id: AGENT_SETTINGS_CREDENTIAL_STATUS_ACTION,
        label: "检查 API Key 状态",
        kind: "specialized",
        requires: [AGENT_CONFIG_READ_PERMISSION],
        reason: "凭据只暴露是否已配置",
      },
      {
        id: AGENT_SETTINGS_SET_API_KEY_ACTION,
        label: "设置 API Key",
        kind: "specialized",
        requires: [AGENT_CONFIG_WRITE_PERMISSION],
        risk: "caution",
        reason: "凭据只写入本机安全存储",
      },
      {
        id: AGENT_SETTINGS_CLEAR_API_KEY_ACTION,
        label: "清除 API Key",
        kind: "specialized",
        requires: [AGENT_CONFIG_WRITE_PERMISSION],
        risk: "destructive",
        reason: "清除本机安全存储中的凭据",
      },
      {
        id: AGENT_SETTINGS_ACP_READ_ACTION,
        label: "读取 ACP 设备设置",
        kind: "specialized",
        requires: [AGENT_CONFIG_READ_PERMISSION],
        reason: "ACP 命令配置只经 provider 返回给可信设置 Display",
      },
      {
        id: AGENT_SETTINGS_ACP_WRITE_ACTION,
        label: "保存 ACP 设备设置",
        kind: "specialized",
        requires: [AGENT_CONFIG_WRITE_PERMISSION],
        risk: "caution",
        reason: "外部进程命令只写入本机配置",
      },
      {
        id: AGENT_SETTINGS_ACP_DETECT_ACTION,
        label: "检测本机 ACP Agent",
        kind: "specialized",
        requires: [AGENT_CONFIG_READ_PERMISSION],
        reason: "只返回检测到的程序与建议参数",
      },
      {
        id: AGENT_SETTINGS_ACP_PROBE_ACTION,
        label: "诊断 ACP Agent 连接",
        kind: "specialized",
        requires: [AGENT_CONFIG_WRITE_PERMISSION],
        risk: "caution",
        reason: "会启动用户配置的本机进程，但不发送真实对话",
      },
    )
  }
  if (section === "workspaces") {
    actions.push(
      {
        id: AGENT_WORKSPACE_CREATE_ACTION,
        label: "创建工作区",
        kind: "specialized",
        requires: [AGENT_CONFIG_WRITE_PERMISSION],
        reason: "由 provider 生成稳定身份和默认结构",
      },
      {
        id: AGENT_WORKSPACE_ACTIVATE_ACTION,
        label: "激活工作区",
        kind: "specialized",
        requires: [AGENT_CONFIG_WRITE_PERMISSION],
        reason: "由 provider 校验工作区身份",
      },
    )
  }
  if (section === "mcp") {
    actions.push(
      {
        id: AGENT_MCP_CREATE_ACTION,
        label: "创建 MCP 服务器",
        kind: "specialized",
        requires: [AGENT_CONFIG_WRITE_PERMISSION],
        risk: "caution",
        reason: "启动参数与凭据位只写入本机，不进入公开配置正文",
      },
      {
        id: AGENT_MCP_PROBE_ACTION,
        label: "测试 MCP 连接",
        kind: "specialized",
        requires: [AGENT_CONFIG_WRITE_PERMISSION],
        risk: "caution",
        reason: "provider 使用未公开的本机连接配置，并只返回脱敏诊断",
      },
    )
  }
  return actions
}

export function createAgentConfigFileSystem(
  deps: AgentConfigFileSystemDeps = defaultDeps,
): FileSystemProvider {
  return {
    descriptor: {
      fileSystemId: AGENT_CONFIG_FILE_SYSTEM_ID,
      name: "AI 智能体配置",
      root: agentConfigRootRef,
      source: SOURCE,
      capabilities: [
        "read-directory",
        "read",
        "write",
        "actions",
        "watch",
        AGENT_CONFIG_READ_PERMISSION,
        AGENT_CONFIG_WRITE_PERMISSION,
      ],
    },
    async stat(ref, ctx) {
      assertAccess(ref, ctx, "metadata", "fs:read")
      if (sameFileRef(ref, agentConfigRootRef)) {
        return {
          ref,
          kind: "directory",
          name: "AI 智能体配置",
          mediaType: AGENT_CONFIG_ROOT_MEDIA_TYPE,
          capabilities: ["read-directory", "actions", "watch", AGENT_CONFIG_READ_PERMISSION],
          source: SOURCE,
          properties: {
            dataKind: AGENT_DATA_SPEC.dataKind,
            dataVersion: AGENT_DATA_SPEC.dataVersion,
            publicConfig: true,
            agentConfigRoot: true,
          },
        }
      }
      const section = sectionIdFromRef(ref)
      if (!section) return null
      const includeContentMetadata = hasPermission(ref, ctx, AGENT_CONFIG_READ_PERMISSION)
      if (!includeContentMetadata) return configFile(section, deps, false)
      return withAgentConfigPreparedRead(section, async () => {
        try {
          await deps.prepare?.(section)
        } catch {
          // stat 仍须保持文件可寻址；Storage 暂不可用时省略正文 size/version，实际 read
          // 再返回结构化错误，避免导航解析因水合失败把真实文件误判为不存在。
          return configFile(section, deps, false)
        }
        return configFile(section, deps)
      })
    },
    async readDirectory(ref, ctx, options: ReadDirectoryOptions = {}): Promise<DirectoryPage> {
      assertAccess(ref, ctx, "directory", "fs:read")
      if (sameFileRef(ref, AGENT_TASKS_FILE_REF)) {
        return withAgentConfigPreparedRead("tasks", async () => {
          await deps.prepare?.("tasks")
          const current = await snapshot("tasks", deps)
          const tasks = [...decodeAgentTasksDocument(current.value)].sort(compareTaskDirectoryOrder)
          const offset = taskDirectoryOffset(ref, options.cursor, current.version)
          const page = paginateDirectoryItems(ref, tasks, { ...options, cursor: offset })
          return {
            entries: page.items.map((task, index) => ({
              entryId: task.id,
              parent: AGENT_TASKS_FILE_REF,
              target: task.threadRef,
              name: task.id,
              kind: "link" as const,
              sortKey: String(page.offset + index).padStart(6, "0"),
              properties: {
                taskId: task.id,
                workspaceId: task.workspaceId,
                status: task.status,
                updatedAt: task.updatedAt,
              },
            })),
            ...(page.nextCursor
              ? { nextCursor: taskDirectoryCursor(current.version, page.nextCursor) }
              : {}),
          }
        })
      }
      if (!sameFileRef(ref, agentConfigRootRef)) {
        throw new FileSystemError("unsupported", "Agent config file is not a directory", ref)
      }
      const page = paginateDirectoryItems(ref, AGENT_PUBLIC_CONFIG_SECTIONS, options)
      return {
        entries: page.items.map((section, index) => ({
          entryId: section.id,
          parent: agentConfigRootRef,
          target: agentConfigFileRef(section.id),
          name: section.fileName,
          kind: "child",
          sortKey: String(page.offset + index).padStart(3, "0"),
          properties: { configSection: section.id, label: section.label, publicConfig: true },
        })),
        nextCursor: page.nextCursor,
      }
    },
    async read(ref, ctx, options: FileReadOptions = {}): Promise<FileReadResult> {
      assertAccess(ref, ctx, "content", AGENT_CONFIG_READ_PERMISSION)
      const section = sectionIdFromRef(ref)
      if (!section) {
        if (sameFileRef(ref, agentConfigRootRef)) {
          throw new FileSystemError("unsupported", "Agent config root has no file content", ref)
        }
        throw new FileSystemError("not-found", `Agent config not found: ${fileRefKey(ref)}`, ref)
      }
      const current = await withAgentConfigPreparedRead(section, async () => {
        await deps.prepare?.(section)
        return snapshot(section, deps)
      })
      const mediaType = mediaTypeForSection(section)
      if ((options.encoding === undefined || options.encoding === "json") && options.range) {
        throw new FileSystemError("invalid-input", "JSON reads do not support byte ranges", ref)
      }
      if (options.encoding === undefined || options.encoding === "json") {
        return {
          data: current.value,
          mediaType,
          size: current.bytes.byteLength,
          version: current.version,
        }
      }
      const bytes = readRange(ref, current.bytes, options)
      return {
        data: options.encoding === "binary" ? bytes : new TextDecoder().decode(bytes),
        mediaType,
        size: bytes.byteLength,
        version: current.version,
      }
    },
    async write(ref, input: FileWriteInput, ctx): Promise<IdeallFile> {
      assertAccess(ref, ctx, "write", AGENT_CONFIG_WRITE_PERMISSION)
      const section = sectionIdFromRef(ref)
      if (!section) {
        if (sameFileRef(ref, agentConfigRootRef)) {
          throw new FileSystemError("unsupported", "Agent config root is not writable", ref)
        }
        throw new FileSystemError("not-found", `Agent config not found: ${fileRefKey(ref)}`, ref)
      }
      const mediaType = mediaTypeForSection(section)
      if (
        input.mediaType &&
        input.mediaType !== AGENT_CONFIG_MEDIA_TYPE &&
        input.mediaType !== mediaType
      ) {
        throw new FileSystemError(
          "invalid-input",
          "Agent config writes require application/json",
          ref,
        )
      }
      return withAgentConfigFileWriteLock(ref, section, async () => {
        await deps.prepare?.(section)
        const current = await snapshot(section, deps)
        assertExpectedVersion(ref, input.expectedVersion, current.version)
        try {
          const value = storageSectionValue(
            ref,
            section,
            await parseWriteData(ref, input.data),
            deps,
          )
          await deps.write(section, value)
        } catch (error) {
          if (error instanceof FileSystemError) throw error
          if (error instanceof ThreadTaskConflictError) {
            throw new FileSystemError("conflict", "Agent tasks changed concurrently", ref)
          }
          if (section === "settings") {
            throw new FileSystemError("invalid-input", "Unable to persist Agent settings", ref)
          }
          throw new FileSystemError(
            "invalid-input",
            error instanceof Error ? error.message : String(error),
            ref,
          )
        }
        return configFile(section, deps)
      })
    },
    async actions(ref, ctx): Promise<FileAction[]> {
      assertAccess(ref, ctx, "action", "fs:read")
      if (sameFileRef(ref, agentConfigRootRef)) return []
      const section = sectionIdFromRef(ref)
      if (!section) throw new FileSystemError("not-found", "Agent config not found", ref)
      return sectionActions(section)
    },
    async invoke(ref, action, input, ctx, options): Promise<unknown> {
      const section = sectionIdFromRef(ref)
      if (!section) throw new FileSystemError("not-found", "Agent config not found", ref)
      if (action === "open") {
        assertAccess(ref, ctx, "action", "fs:read")
        assertNoActionInput(ref, input, "Open")
        return { ref }
      }
      if (section === "settings" && action === AGENT_SETTINGS_ACP_READ_ACTION) {
        assertAccess(ref, ctx, "action", AGENT_CONFIG_READ_PERMISSION)
        assertNoActionInput(ref, input, "Read ACP settings")
        if (!deps.readAcpSettings) {
          throw new FileSystemError("unsupported", "ACP settings are unavailable", ref)
        }
        try {
          return decodeAgentAcpSettings(deps.readAcpSettings())
        } catch {
          throw new FileSystemError("unavailable", "Unable to read ACP settings", ref)
        }
      }
      if (section === "settings" && action === AGENT_SETTINGS_ACP_WRITE_ACTION) {
        assertAccess(ref, ctx, "action", AGENT_CONFIG_WRITE_PERMISSION)
        const next = acpSettingsInput(ref, input)
        if (!deps.writeAcpSettings || !deps.readAcpSettings) {
          throw new FileSystemError("unsupported", "ACP settings writes are unavailable", ref)
        }
        return withAgentSettingsFileWriteLock(async () => {
          await deps.prepare?.(section)
          assertExpectedVersion(
            ref,
            options?.expectedVersion,
            (await snapshot(section, deps)).version,
          )
          try {
            await deps.writeAcpSettings!(next)
            return decodeAgentAcpSettings(deps.readAcpSettings!())
          } catch (error) {
            if (error instanceof FileSystemError) throw error
            throw new FileSystemError("unavailable", "Unable to persist ACP settings", ref)
          }
        })
      }
      if (section === "settings" && action === AGENT_SETTINGS_ACP_DETECT_ACTION) {
        assertAccess(ref, ctx, "action", AGENT_CONFIG_READ_PERMISSION)
        assertNoActionInput(ref, input, "Detect ACP agents")
        if (!deps.detectAcpAgents) {
          throw new FileSystemError("unsupported", "ACP agent detection is unavailable", ref)
        }
        try {
          return decodeAgentDetectedAcpAgents(await deps.detectAcpAgents())
        } catch {
          // 原生探测错误可能携带本机路径；provider 边界不回显。
          throw new FileSystemError("unavailable", "ACP agent detection failed", ref)
        }
      }
      if (section === "settings" && action === AGENT_SETTINGS_ACP_PROBE_ACTION) {
        assertAccess(ref, ctx, "action", AGENT_CONFIG_WRITE_PERMISSION)
        const config = acpProbeInput(ref, input)
        if (!deps.probeAcpAgent) {
          throw new FileSystemError(
            "unsupported",
            "ACP connection diagnostics are unavailable",
            ref,
          )
        }
        try {
          return decodeAgentAcpProbeResult(await deps.probeAcpAgent(config))
        } catch {
          // spawn / SDK 错误可能携带程序和工作目录；公开面只返回稳定错误。
          throw new FileSystemError("unavailable", "ACP connection diagnostics failed", ref)
        }
      }
      if (section === "settings" && action === AGENT_SETTINGS_CREDENTIAL_STATUS_ACTION) {
        assertAccess(ref, ctx, "action", AGENT_CONFIG_READ_PERMISSION)
        assertNoActionInput(ref, input, "Credential status")
        if (!deps.readSettingsCredentialConfigured) {
          throw new FileSystemError("unsupported", "Credential status is unavailable", ref)
        }
        return withAgentSettingsFileWriteLock(async () => {
          try {
            const configured = await deps.readSettingsCredentialConfigured!()
            if (typeof configured !== "boolean") {
              throw new FileSystemError(
                "unavailable",
                "Credential provider returned invalid status",
                ref,
              )
            }
            return { configured } satisfies AgentSettingsCredentialStatus
          } catch (error) {
            if (error instanceof FileSystemError) throw error
            throw new FileSystemError("offline", "Unable to read AI credential status", ref)
          }
        })
      }
      if (section === "settings" && action === AGENT_SETTINGS_SET_API_KEY_ACTION) {
        assertAccess(ref, ctx, "action", AGENT_CONFIG_WRITE_PERMISSION)
        const apiKey = settingsApiKeyInput(ref, input)
        if (!deps.writeSettingsApiKey) {
          throw new FileSystemError("unsupported", "Credential writes are unavailable", ref)
        }
        return withAgentSettingsFileWriteLock(async () => {
          await deps.prepare?.(section)
          assertExpectedVersion(
            ref,
            options?.expectedVersion,
            (await snapshot(section, deps)).version,
          )
          try {
            await deps.writeSettingsApiKey!(apiKey)
          } catch {
            throw credentialMutationError(ref)
          }
          return { configured: true } satisfies AgentSettingsCredentialStatus
        })
      }
      if (section === "settings" && action === AGENT_SETTINGS_CLEAR_API_KEY_ACTION) {
        assertAccess(ref, ctx, "action", AGENT_CONFIG_WRITE_PERMISSION)
        assertNoActionInput(ref, input, "Clear API key")
        if (!deps.deleteSettingsApiKey) {
          throw new FileSystemError("unsupported", "Credential deletion is unavailable", ref)
        }
        return withAgentSettingsFileWriteLock(async () => {
          await deps.prepare?.(section)
          assertExpectedVersion(
            ref,
            options?.expectedVersion,
            (await snapshot(section, deps)).version,
          )
          try {
            await deps.deleteSettingsApiKey!()
          } catch {
            throw credentialMutationError(ref)
          }
          return { configured: false } satisfies AgentSettingsCredentialStatus
        })
      }
      if (section === "workspaces" && action === AGENT_WORKSPACE_CREATE_ACTION) {
        assertAccess(ref, ctx, "action", AGENT_CONFIG_WRITE_PERMISSION)
        const name = workspaceCreateName(ref, input)
        if (!deps.createWorkspace) {
          throw new FileSystemError("unsupported", "Workspace creation is unavailable", ref)
        }
        return withAgentConfigFileWriteLock(ref, section, async () => {
          await deps.prepare?.(section)
          assertExpectedVersion(
            ref,
            options?.expectedVersion,
            (await snapshot(section, deps)).version,
          )
          try {
            return workspaceCreateResult(ref, await deps.createWorkspace!(name))
          } catch (error) {
            throw mutationError(ref, "Create workspace", error)
          }
        })
      }
      if (section === "workspaces" && action === AGENT_WORKSPACE_ACTIVATE_ACTION) {
        assertAccess(ref, ctx, "action", AGENT_CONFIG_WRITE_PERMISSION)
        const workspaceId = workspaceActivateId(ref, input)
        if (!deps.activateWorkspace) {
          throw new FileSystemError("unsupported", "Workspace activation is unavailable", ref)
        }
        return withAgentConfigFileWriteLock(ref, section, async () => {
          await deps.prepare?.(section)
          assertExpectedVersion(
            ref,
            options?.expectedVersion,
            (await snapshot(section, deps)).version,
          )
          try {
            const result = await deps.activateWorkspace!(workspaceId)
            return workspaceActivateResult(ref, result, workspaceId)
          } catch (error) {
            throw mutationError(ref, "Activate workspace", error)
          }
        })
      }
      if (section === "mcp" && action === AGENT_MCP_CREATE_ACTION) {
        assertAccess(ref, ctx, "action", AGENT_CONFIG_WRITE_PERMISSION)
        const server = mcpCreateInput(ref, input)
        if (!deps.createMcpServer) {
          throw new FileSystemError("unsupported", "MCP server creation is unavailable", ref)
        }
        return withFileWriteLock(ref, async () => {
          await deps.prepare?.(section)
          assertExpectedVersion(
            ref,
            options?.expectedVersion,
            (await snapshot(section, deps)).version,
          )
          try {
            return mcpCreateResult(ref, await deps.createMcpServer!(server))
          } catch (error) {
            if (error instanceof FileSystemError) throw error
            throw new FileSystemError("unavailable", "Create MCP server failed", ref)
          }
        })
      }
      if (section === "mcp" && action === AGENT_MCP_PROBE_ACTION) {
        assertAccess(ref, ctx, "action", AGENT_CONFIG_WRITE_PERMISSION)
        const serverId = mcpProbeServerId(ref, input)
        if (!deps.probeMcpServer) {
          throw new FileSystemError("unsupported", "MCP connection probe is unavailable", ref)
        }
        try {
          const result = await deps.probeMcpServer(serverId)
          if (result === null) throw new FileSystemError("not-found", "MCP server not found", ref)
          return mcpProbeResult(ref, result)
        } catch (error) {
          if (error instanceof FileSystemError) throw error
          // 外部传输错误可能包含完整 URL/命令参数；provider 边界不回显异常正文。
          throw new FileSystemError("unavailable", "MCP connection probe failed", ref)
        }
      }
      assertAccess(ref, ctx, "action", "fs:read")
      throw new FileSystemError("unsupported", `Unsupported Agent config action: ${action}`, ref)
    },
    watch(ref, ctx, notify): FileSystemWatchHandle | null {
      assertAccess(ref, ctx, "watch", AGENT_CONFIG_READ_PERMISSION)
      const watchedSections = sameFileRef(ref, agentConfigRootRef)
        ? AGENT_PUBLIC_CONFIG_SECTIONS.map((section) => section.id)
        : (() => {
            const section = sectionIdFromRef(ref)
            return section ? [section] : []
          })()
      if (!watchedSections.length) return null
      const disposers: Array<() => void> = []
      let active = true
      let observedVersionGeneration = 0
      let versionedNotificationQueue = Promise.resolve()
      const deliverChange = (
        eventSection: AgentPublicConfigSectionId,
        version: string | undefined,
      ) => {
        if (!active) return
        const sectionRef = agentConfigFileRef(eventSection)
        const event: FileSystemWatchEvent = {
          type: "changed",
          ref: sectionRef,
          entryId: eventSection,
          oldParent: agentConfigRootRef,
          newParent: agentConfigRootRef,
          ...(version ? { version } : {}),
        }
        try {
          notify(event)
        } catch {}
      }
      const notifyChange = (
        eventSection: AgentPublicConfigSectionId,
        includeObservedVersion = true,
      ) => {
        if (!active) return
        const sectionRef = agentConfigFileRef(eventSection)
        if (!includeObservedVersion) {
          // 跨窗失效表示接收端必须重读；不能再让先前排队的瞬时版本越过它。
          observedVersionGeneration += 1
          deliverChange(eventSection, undefined)
          return
        }
        if (!hasPermission(sectionRef, ctx, AGENT_CONFIG_READ_PERMISSION)) {
          deliverChange(eventSection, undefined)
          return
        }
        // 先同步捕获语义快照，再异步计算 SHA-256；队列保持上游通知顺序。
        const generation = observedVersionGeneration
        const observedVersion = snapshot(eventSection, deps).then(
          (current) => current.version,
          () => undefined,
        )
        versionedNotificationQueue = versionedNotificationQueue.then(async () => {
          // 数据源暂不可读时仍发送失效事件，由下一次 stat/read 给出结构化错误。
          const version = await observedVersion
          if (!active || generation !== observedVersionGeneration) return
          deliverChange(eventSection, version)
        })
      }
      const subscribeChange = (
        sourceSection: AgentPublicConfigSectionId,
        eventSection: AgentPublicConfigSectionId,
      ) => {
        disposers.push(deps.subscribe(sourceSection, () => notifyChange(eventSection)))
      }
      try {
        for (const section of watchedSections) {
          subscribeChange(section, section)
        }
        if (watchedSections.includes("settings") && deps.subscribeAcpSettings) {
          disposers.push(deps.subscribeAcpSettings(() => notifyChange("settings")))
        }
        if (watchedSections.includes("workspaces")) {
          // workspaces 的 taskCount 与乐观版本依赖 tasks，必须共享同一失效通路。
          subscribeChange("tasks", "workspaces")
        }
        disposers.push(
          subscribeAgentImportInvalidation((source) => {
            // 同窗口 importer 已由各 store 的 subscribe 精确通知；只补 Tauri 其它窗口的整包失效。
            if (source === "local") return
            // 跨窗口 Storage 可见性与广播任务不共享顺序保证；不附接收端瞬时版本，强制 Display 重读。
            for (const section of watchedSections) notifyChange(section, false)
          }),
        )
      } catch (error) {
        // root 需同时订阅全部 section；部分建立失败必须回滚，且每个 disposer 相互隔离。
        active = false
        for (const dispose of disposers.reverse()) {
          try {
            dispose()
          } catch {}
        }
        throw error
      }
      return {
        dispose: () => {
          if (!active) return
          active = false
          for (const dispose of disposers.splice(0).reverse()) {
            try {
              dispose()
            } catch {}
          }
        },
      }
    },
  }
}

export const agentConfigFileSystem = createAgentConfigFileSystem()
