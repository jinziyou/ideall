export type ExternalMcpTransport = "stdio" | "sse" | "http"
export type McpDiagnosticStatus =
  "unknown" | "checking" | "healthy" | "connected" | "degraded" | "error"
export type McpFailureKind =
  | "configuration"
  | "authentication"
  | "timeout"
  | "unsupported"
  | "protocol"
  | "unavailable"
  | "transport"
  | "unknown"
export type McpCallStatus = "success" | "tool-error" | "transport-error"

export type McpDiagnosticTarget = Readonly<{
  serverId: string
  transport: ExternalMcpTransport
  /** 配置内容不进入诊断；只用公开 updatedAt 阻止旧连接覆盖新目标的状态。 */
  configRevision?: number
}>

export type McpSafeFailure = Readonly<{
  kind: McpFailureKind
  code: string
  message: string
}>

export type McpLastCallDiagnostic = Readonly<{
  toolName: string
  status: McpCallStatus
  startedAt: number
  finishedAt: number
  durationMs: number
}>

export type McpConnectionDiagnostic = Readonly<{
  serverId: string
  transport: ExternalMcpTransport
  configRevision: number | null
  status: McpDiagnosticStatus
  activeSessions: number
  checkedAt: number | null
  durationMs: number | null
  toolCount: number | null
  failure: McpSafeFailure | null
  lastCall: McpLastCallDiagnostic | null
}>

type ConnectionResult =
  | Readonly<{
      ok: true
      checkedAt: number
      durationMs: number
      toolCount: number
    }>
  | Readonly<{
      ok: false
      checkedAt: number
      durationMs: number
      failure: McpSafeFailure
    }>

type InternalDiagnostic = {
  serverId: string
  transport: ExternalMcpTransport
  configRevision: number | null
  generation: number
  checking: number
  activeSessions: number
  result?: ConnectionResult
  lastCall?: McpLastCallDiagnostic
  updatedAt: number
}

export type McpConnectionAttempt = Readonly<{
  serverId: string
  transport: ExternalMcpTransport
  configRevision: number | null
  generation: number
  token: number
  startedAt: number
}>

export type McpToolCallAttempt = Readonly<{
  serverId: string
  transport: ExternalMcpTransport
  configRevision: number | null
  generation: number
  token: number
  toolName: string
  startedAt: number
}>

const MAX_DIAGNOSTICS = 256
const EMPTY_DIAGNOSTICS: readonly McpConnectionDiagnostic[] = Object.freeze([])
const diagnostics = new Map<string, InternalDiagnostic>()
let completedConnections = new WeakSet<object>()
let completedCalls = new WeakSet<object>()
const listeners = new Set<() => void>()
let generation = 0
let sequence = 0
let published: readonly McpConnectionDiagnostic[] = Object.freeze([])

function now(value?: number): number {
  const candidate = value ?? Date.now()
  return Number.isSafeInteger(candidate) && candidate >= 0 ? candidate : 0
}

function revision(value?: number): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : null
}

function duration(startedAt: number, finishedAt: number): number {
  return Math.max(0, finishedAt - startedAt)
}

function statusOf(state: InternalDiagnostic): McpDiagnosticStatus {
  if (state.activeSessions > 0) return state.result?.ok === false ? "degraded" : "connected"
  if (state.checking > 0) return "checking"
  if (state.result?.ok === true) return "healthy"
  if (state.result?.ok === false) return "error"
  return "unknown"
}

function snapshotOf(state: InternalDiagnostic): McpConnectionDiagnostic {
  const result = state.result
  return Object.freeze({
    serverId: state.serverId,
    transport: state.transport,
    configRevision: state.configRevision,
    status: statusOf(state),
    activeSessions: state.activeSessions,
    checkedAt: result?.checkedAt ?? null,
    durationMs: result?.durationMs ?? null,
    toolCount: result?.ok === true ? result.toolCount : null,
    failure: result?.ok === false ? result.failure : null,
    lastCall: state.lastCall ?? null,
  })
}

function publish(): void {
  if (diagnostics.size > MAX_DIAGNOSTICS) {
    const removable = [...diagnostics.values()]
      .filter((item) => item.activeSessions === 0 && item.checking === 0)
      .sort((left, right) => left.updatedAt - right.updatedAt)
    while (diagnostics.size > MAX_DIAGNOSTICS && removable.length > 0) {
      diagnostics.delete(removable.shift()!.serverId)
    }
    if (diagnostics.size > MAX_DIAGNOSTICS) {
      const oldest = [...diagnostics.values()].sort(
        (left, right) => left.updatedAt - right.updatedAt,
      )
      while (diagnostics.size > MAX_DIAGNOSTICS && oldest.length > 0) {
        diagnostics.delete(oldest.shift()!.serverId)
      }
    }
  }
  published = Object.freeze(
    [...diagnostics.values()]
      .sort((left, right) => left.serverId.localeCompare(right.serverId))
      .map(snapshotOf),
  )
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      // 诊断状态已提交；观察者故障不能影响连接或工具调用。
    }
  }
}

function stateFor(target: McpDiagnosticTarget, timestamp: number): InternalDiagnostic {
  const configRevision = revision(target.configRevision)
  const current = diagnostics.get(target.serverId)
  if (
    current &&
    current.transport === target.transport &&
    current.configRevision === configRevision
  ) {
    return current
  }
  const state: InternalDiagnostic = {
    serverId: target.serverId,
    transport: target.transport,
    configRevision,
    generation: ++generation,
    checking: 0,
    activeSessions: 0,
    updatedAt: timestamp,
  }
  diagnostics.set(target.serverId, state)
  return state
}

function currentFor(attempt: { serverId: string; generation: number }): InternalDiagnostic | null {
  const current = diagnostics.get(attempt.serverId)
  return current?.generation === attempt.generation ? current : null
}

export function sanitizeMcpToolName(value: unknown): string {
  if (typeof value !== "string") return "external-tool"
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (!cleaned) return "external-tool"
  return cleaned.length > 128 ? `${cleaned.slice(0, 127)}…` : cleaned
}

/** 原始错误只参与本地分类；返回值完全由稳定常量构造，不回显 URL、命令、参数或凭据。 */
export function safeMcpFailure(error: unknown, transport: ExternalMcpTransport): McpSafeFailure {
  const raw = (
    error instanceof Error ? `${error.name} ${error.message}` : String(error)
  ).toLowerCase()
  const failure = (kind: McpFailureKind, code: string, message: string): McpSafeFailure =>
    Object.freeze({ kind, code, message })

  if (/oauth|unauthori[sz]ed|forbidden|\b401\b|\b403\b|authentication/.test(raw)) {
    return failure("authentication", "authentication-required", "认证失败或尚未授权")
  }
  if (/timeout|timed out|deadline|aborterror/.test(raw)) {
    return failure("timeout", "operation-timeout", "MCP 连接或调用超时")
  }
  if (/acp-unavailable|not supported|unsupported platform|仅 app|仅桌面/.test(raw)) {
    return failure("unsupported", "transport-unsupported", "当前平台不支持该 MCP 传输")
  }
  if (
    /invalid url|url is invalid|配置不完整|missing (url|command)|empty-program|invalid header|not-a-url/.test(
      raw,
    )
  ) {
    return failure("configuration", "invalid-configuration", "MCP 连接配置无效")
  }
  if (/json-rpc|jsonrpc|protocol|parse|unexpected token|initialize|method not found/.test(raw)) {
    return failure("protocol", "protocol-error", "服务响应不符合 MCP 协议")
  }
  if (
    /econn|enotfound|dns|fetch failed|network|socket|connection|program-not-found|spawn-failed|no-stdout|no-stdin|non-200.*\b(404|5\d\d)\b|http (?:error|status).*\b(404|5\d\d)\b/.test(
      raw,
    )
  ) {
    return failure(
      "unavailable",
      "service-unavailable",
      transport === "stdio" ? "无法启动或连接本地 MCP 服务" : "MCP 服务不可达",
    )
  }
  if (raw && raw !== "undefined" && raw !== "null") {
    return failure("transport", "transport-error", "MCP 传输失败")
  }
  return failure("unknown", "unknown-error", "MCP 操作失败")
}

export function beginMcpConnection(
  target: McpDiagnosticTarget,
  timestamp?: number,
): McpConnectionAttempt {
  const startedAt = now(timestamp)
  const state = stateFor(target, startedAt)
  state.checking += 1
  state.updatedAt = startedAt
  const attempt = Object.freeze({
    serverId: state.serverId,
    transport: state.transport,
    configRevision: state.configRevision,
    generation: state.generation,
    token: ++sequence,
    startedAt,
  })
  publish()
  return attempt
}

export function completeMcpConnection(
  attempt: McpConnectionAttempt,
  details: Readonly<{ toolCount: number; active?: boolean }>,
  timestamp?: number,
): () => void {
  if (completedConnections.has(attempt)) return () => {}
  completedConnections.add(attempt)
  const state = currentFor(attempt)
  if (!state) return () => {}
  const finishedAt = now(timestamp)
  state.checking = Math.max(0, state.checking - 1)
  state.activeSessions += details.active ? 1 : 0
  state.result = Object.freeze({
    ok: true,
    checkedAt: finishedAt,
    durationMs: duration(attempt.startedAt, finishedAt),
    toolCount:
      Number.isSafeInteger(details.toolCount) && details.toolCount >= 0 ? details.toolCount : 0,
  })
  state.updatedAt = finishedAt
  publish()

  let released = false
  return () => {
    if (released || !details.active) return
    released = true
    const current = currentFor(attempt)
    if (!current) return
    current.activeSessions = Math.max(0, current.activeSessions - 1)
    current.updatedAt = now()
    publish()
  }
}

export function failMcpConnection(
  attempt: McpConnectionAttempt,
  error: unknown,
  timestamp?: number,
): McpSafeFailure {
  const failure = safeMcpFailure(error, attempt.transport)
  if (completedConnections.has(attempt)) return failure
  completedConnections.add(attempt)
  const state = currentFor(attempt)
  if (!state) return failure
  const finishedAt = now(timestamp)
  state.checking = Math.max(0, state.checking - 1)
  state.result = Object.freeze({
    ok: false,
    checkedAt: finishedAt,
    durationMs: duration(attempt.startedAt, finishedAt),
    failure,
  })
  state.updatedAt = finishedAt
  publish()
  return failure
}

export function beginMcpToolCall(
  target: McpDiagnosticTarget,
  toolName: unknown,
  timestamp?: number,
): McpToolCallAttempt {
  const startedAt = now(timestamp)
  const state = stateFor(target, startedAt)
  return Object.freeze({
    serverId: state.serverId,
    transport: state.transport,
    configRevision: state.configRevision,
    generation: state.generation,
    token: ++sequence,
    toolName: sanitizeMcpToolName(toolName),
    startedAt,
  })
}

export function completeMcpToolCall(
  attempt: McpToolCallAttempt,
  status: McpCallStatus,
  error?: unknown,
  timestamp?: number,
): void {
  if (completedCalls.has(attempt)) return
  completedCalls.add(attempt)
  const state = currentFor(attempt)
  if (!state) return
  const finishedAt = now(timestamp)
  state.lastCall = Object.freeze({
    toolName: attempt.toolName,
    status,
    startedAt: attempt.startedAt,
    finishedAt,
    durationMs: duration(attempt.startedAt, finishedAt),
  })
  if (status === "transport-error") {
    state.result = Object.freeze({
      ok: false,
      checkedAt: finishedAt,
      durationMs: duration(attempt.startedAt, finishedAt),
      failure: safeMcpFailure(error, attempt.transport),
    })
  }
  state.updatedAt = finishedAt
  publish()
}

export function getMcpDiagnostics(): readonly McpConnectionDiagnostic[] {
  return published
}

export function getServerMcpDiagnostics(): readonly McpConnectionDiagnostic[] {
  return EMPTY_DIAGNOSTICS
}

export function subscribeMcpDiagnostics(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function diagnosticForMcpServer(
  serverId: string,
  configRevision: number,
  values: readonly McpConnectionDiagnostic[] = published,
): McpConnectionDiagnostic | undefined {
  return values.find(
    (item) => item.serverId === serverId && item.configRevision === revision(configRevision),
  )
}

export function clearMcpDiagnostics(): void {
  diagnostics.clear()
  completedConnections = new WeakSet<object>()
  completedCalls = new WeakSet<object>()
  publish()
}
