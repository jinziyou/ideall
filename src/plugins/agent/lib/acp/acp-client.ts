// ACP 客户端方向执行器：由用户配置命令启动外部 Agent，并把一轮 ACP 会话投影回 ideall 对话。
// 不声明文件系统/终端能力、不注入 ideall MCP；外部 Agent 的权限请求统一经过现有确认与脱敏审计。
import * as acp from "@agentclientprotocol/sdk"
import type {
  RequestPermissionRequest,
  SessionUpdate,
  StopReason,
  Stream,
  ToolCallStatus,
} from "@agentclientprotocol/sdk"
import { acpClose, acpSpawn, createAcpStream } from "@/lib/acp-transport"
import type { AgentToolPreview } from "../agent-tool-preview"
import type { AgentToolEvent } from "../model"
import type { ExternalAgentConfig } from "./acp-settings"
import { EMPTY_TURN, foldAcpUpdate, pickPermissionOption, turnToolEvents } from "./acp-chat"

const MAX_ARGUMENTS = 128
const MAX_ARGUMENT_LENGTH = 4_096
const MAX_PROMPT_LENGTH = 512 * 1024
const MAX_PENDING_PERMISSIONS = 128
const RUN_TIMEOUT_MS = 10 * 60 * 1_000
const PROBE_TIMEOUT_MS = 15_000

export type ExternalAcpMessage = Readonly<{
  role: "system" | "user" | "assistant"
  content: string
}>

export type ExternalAcpPermissionAuditEvent = Readonly<{
  preview: AgentToolPreview
  status: "committed" | "failed" | "rejected"
  summary: string
  auditId?: string
}>

export interface ExternalAcpRunOptions {
  config: ExternalAgentConfig
  messages: readonly ExternalAcpMessage[]
  signal: AbortSignal
  /** 普通对话模式为 false：ACP 权限请求会直接拒绝，不弹确认。 */
  allowPermissions: boolean
  onApprove?: (preview: AgentToolPreview) => Promise<boolean>
  onPermissionIntent?: (preview: AgentToolPreview) => Promise<string | undefined>
  onPermissionAudit?: (event: ExternalAcpPermissionAuditEvent) => Promise<void>
  onUpdate?: (content: string, toolEvents: AgentToolEvent[]) => void
}

export interface ExternalAcpRunResult {
  content: string
  toolEvents: AgentToolEvent[]
  canceled: boolean
  stopReason?: StopReason
}

export interface ExternalAcpProbeResult {
  latencyMs: number
  protocolVersion: number
}

type PendingPermission = Readonly<{
  preview: AgentToolPreview
  auditId?: string
}>

function cleanText(value: string, maxLength: number, fallback: string): string {
  const normalized = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/gu, " ").trim()
  if (!normalized) return fallback
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized
}

/** 只做 argv 切分，不经过 shell，因此不会展开变量、命令替换或重定向。 */
export function parseExternalAgentArgs(input: string): string[] {
  if (/[\u0000\r\n]/u.test(input)) throw new Error("acp-invalid-args: 参数包含控制字符")
  const args: string[] = []
  let current = ""
  let quote: "'" | '"' | null = null

  const push = () => {
    if (!current) return
    if (current.length > MAX_ARGUMENT_LENGTH) throw new Error("acp-invalid-args: 参数过长")
    args.push(current)
    current = ""
    if (args.length > MAX_ARGUMENTS) throw new Error("acp-invalid-args: 参数过多")
  }

  const source = input.trim()
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (char === "\\" && quote !== "'") {
      const next = source[index + 1]
      if (
        next !== undefined &&
        (/\s/u.test(next) || next === "\\" || next === "'" || next === '"')
      ) {
        current += next
        index += 1
      } else {
        // 非 shell 执行；保留 Windows 路径等普通反斜杠。
        current += char
      }
      continue
    }
    if (char === "'" || char === '"') {
      if (quote === char) quote = null
      else if (quote === null) quote = char
      else current += char
      continue
    }
    if (/\s/u.test(char) && quote === null) push()
    else current += char
  }
  if (quote !== null) throw new Error("acp-invalid-args: 引号未闭合")
  push()
  return args
}

export function buildExternalAcpPrompt(messages: readonly ExternalAcpMessage[]): string {
  const roleName = { system: "系统", user: "用户", assistant: "助手" } as const
  const header =
    "你正在作为 ideall 的可选外部 ACP 执行后端。以下是本轮所需的系统约束与最近对话；请直接完成最后一条用户请求。"
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => `【系统】\n${cleanText(message.content, 128 * 1024, "（空）")}`)
    .join("\n\n")
  const fixed = [header, system].filter(Boolean).join("\n\n")
  let remaining = Math.max(0, MAX_PROMPT_LENGTH - fixed.length - 2)
  const history: string[] = []
  for (const message of messages.filter((candidate) => candidate.role !== "system").toReversed()) {
    if (remaining <= 0) break
    const block = `【${roleName[message.role]}】\n${cleanText(message.content, MAX_PROMPT_LENGTH, "（空）")}`
    const selected =
      block.length <= remaining ? block : `…${block.slice(block.length - remaining + 1)}`
    history.unshift(selected)
    remaining -= selected.length + 2
  }
  return [fixed, ...history].filter(Boolean).join("\n\n").slice(0, MAX_PROMPT_LENGTH)
}

function permissionPreview(request: RequestPermissionRequest): AgentToolPreview {
  const title = cleanText(request.toolCall.title ?? "", 160, "外部 Agent 请求执行工具")
  const kind = request.toolCall.kind
  const locationCount = request.toolCall.locations?.length ?? 0
  return {
    toolName: cleanText(`external-acp.${kind ?? "tool"}`, 160, "external-acp.tool"),
    title,
    summary: "外部进程请求执行工具；ideall 无法完整验证其参数、副作用或进程级访问范围",
    effect: "external",
    risk: "high",
    mutating: true,
    fields: [
      ...(kind ? [{ label: "类型", value: cleanText(kind, 80, "tool") }] : []),
      ...(locationCount
        ? [{ label: "涉及位置", value: `${Math.min(locationCount, 999)} 项（路径已隐藏）` }]
        : []),
    ],
  }
}

function terminalStatus(update: SessionUpdate): ToolCallStatus | undefined {
  if (update.sessionUpdate !== "tool_call" && update.sessionUpdate !== "tool_call_update") {
    return undefined
  }
  return update.status ?? undefined
}

function toolCallId(update: SessionUpdate): string | undefined {
  return update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update"
    ? update.toolCallId
    : undefined
}

/**
 * 对一个已建立的 ACP message stream 跑完整会话。导出该层以便用 SDK 内存 Agent 做协议级测试。
 */
export async function runExternalAcpOverStream(
  stream: Stream,
  cwd: string,
  options: Omit<ExternalAcpRunOptions, "config">,
): Promise<ExternalAcpRunResult> {
  let turn = EMPTY_TURN
  let stopReason: StopReason | undefined
  let permissionError: unknown
  let permissionRequests = 0
  let permissionOverflowAudited = false
  const pendingPermissions = new Map<string, PendingPermission>()

  const audit = async (event: ExternalAcpPermissionAuditEvent): Promise<void> => {
    try {
      await options.onPermissionAudit?.(event)
    } catch {
      // 执行结果不能因本机审计回执失败而被自动重放；UI 回调负责明确提示降级。
    }
  }

  const settlePermission = async (update: SessionUpdate): Promise<void> => {
    const id = toolCallId(update)
    const status = terminalStatus(update)
    if (!id || (status !== "completed" && status !== "failed")) return
    const pending = pendingPermissions.get(id)
    if (!pending) return
    pendingPermissions.delete(id)
    await audit({
      ...pending,
      status: status === "completed" ? "committed" : "failed",
      summary:
        status === "completed" ? "外部 Agent 报告工具执行完成" : "外部 Agent 报告工具执行失败",
    })
  }

  const app = acp
    .client({ name: "ideall" })
    .onRequest(acp.methods.client.session.requestPermission, async (context) => {
      const request = context.params
      const preview = permissionPreview(request)
      permissionRequests += 1
      if (permissionRequests > MAX_PENDING_PERMISSIONS) {
        if (!permissionOverflowAudited) {
          permissionOverflowAudited = true
          await audit({ preview, status: "rejected", summary: "外部 Agent 权限请求过多，已拒绝" })
        }
        return { outcome: { outcome: "cancelled" } }
      }
      let allowed = false
      if (options.allowPermissions && !options.signal.aborted) {
        allowed = (await options.onApprove?.(preview)) === true
      }
      const selected = pickPermissionOption(request.options, allowed)
      if (!selected) {
        await audit({ preview, status: "rejected", summary: "外部 Agent 工具权限已拒绝" })
        return { outcome: { outcome: "cancelled" } }
      }
      if (pendingPermissions.size >= MAX_PENDING_PERMISSIONS) {
        await audit({ preview, status: "rejected", summary: "外部 Agent 权限请求过多，已拒绝" })
        return { outcome: { outcome: "cancelled" } }
      }
      if (pendingPermissions.has(request.toolCall.toolCallId)) {
        await audit({ preview, status: "rejected", summary: "外部 Agent 重复请求同一工具权限" })
        return { outcome: { outcome: "cancelled" } }
      }
      try {
        if (!options.onPermissionIntent) throw new Error("acp-audit-unavailable")
        const auditId = await options.onPermissionIntent(preview)
        if (!auditId) throw new Error("acp-audit-invalid-receipt")
        pendingPermissions.set(request.toolCall.toolCallId, { preview, auditId })
      } catch (error) {
        permissionError = error
        return { outcome: { outcome: "cancelled" } }
      }
      return { outcome: { outcome: "selected", optionId: selected.optionId } }
    })

  try {
    const result = await app.connectWith(stream, async (agent) => {
      await agent.request(
        acp.methods.agent.initialize,
        { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} },
        { cancellationSignal: options.signal },
      )
      return agent.buildSession({ cwd, mcpServers: [] }).withSession(async (session) => {
        void session.prompt(buildExternalAcpPrompt(options.messages), {
          cancellationSignal: options.signal,
        })
        for (;;) {
          const message = await session.nextUpdate()
          if (message.kind === "stop") {
            stopReason = message.stopReason
            break
          }
          turn = foldAcpUpdate(turn, message.update)
          await settlePermission(message.update)
          options.onUpdate?.(turn.text, turnToolEvents(turn))
        }
        if (permissionError) throw permissionError
        return {
          content: turn.text,
          toolEvents: turnToolEvents(turn),
          canceled: options.signal.aborted || stopReason === "cancelled",
          ...(stopReason ? { stopReason } : {}),
        }
      })
    })
    return result
  } catch (error) {
    if (!options.signal.aborted) throw error
    return {
      content: turn.text,
      toolEvents: turnToolEvents(turn),
      canceled: true,
      ...(stopReason ? { stopReason } : {}),
    }
  } finally {
    for (const pending of pendingPermissions.values()) {
      await audit({
        ...pending,
        status: "failed",
        summary: options.signal.aborted
          ? "外部 Agent 会话已取消，工具结果无法确认"
          : "外部 Agent 未返回可验证的工具终态",
      })
    }
  }
}

function aborted(): DOMException {
  return new DOMException("The operation was aborted", "AbortError")
}

async function resolveCwd(configured: string): Promise<string> {
  const cwd = configured.trim()
  const path = await import("@tauri-apps/api/path")
  const resolved = cwd || (await path.homeDir())
  if (!(await path.isAbsolute(resolved))) throw new Error("acp-invalid-cwd: 工作目录必须是绝对路径")
  return resolved
}

async function withExternalAcpProcess<T>(
  config: ExternalAgentConfig,
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
  operation: (stream: Stream, cwd: string, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const program = config.program.trim()
  if (!program) throw new Error("acp-empty-program: 请先配置外部 Agent 程序")
  if (program.length > 512 || /[\u0000\r\n]/u.test(program)) {
    throw new Error("acp-invalid-program: 外部 Agent 程序无效")
  }
  if (parentSignal?.aborted) throw aborted()
  const args = parseExternalAgentArgs(config.args)
  const cwd = await resolveCwd(config.cwd)
  const id = `external-agent-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`
  const controller = new AbortController()
  let timedOut = false
  const abort = () => controller.abort(parentSignal?.reason)
  parentSignal?.addEventListener("abort", abort, { once: true })
  const timer = globalThis.setTimeout(() => {
    timedOut = true
    controller.abort(new Error("acp-timeout"))
  }, timeoutMs)

  let spawned = false
  let transport: Awaited<ReturnType<typeof createAcpStream>> | undefined
  const closeOnAbort = () => {
    if (spawned) void acpClose(id).catch(() => {})
  }
  controller.signal.addEventListener("abort", closeOnAbort, { once: true })
  try {
    transport = await createAcpStream(id)
    await acpSpawn(id, program, args, cwd)
    spawned = true
    const result = await operation(transport.stream, cwd, controller.signal)
    if (timedOut) throw new Error("acp-timeout: 外部 Agent 响应超时")
    return result
  } catch (error) {
    if (timedOut) throw new Error("acp-timeout: 外部 Agent 响应超时")
    throw error
  } finally {
    globalThis.clearTimeout(timer)
    parentSignal?.removeEventListener("abort", abort)
    controller.signal.removeEventListener("abort", closeOnAbort)
    transport?.dispose()
    if (spawned) await acpClose(id).catch(() => {})
  }
}

export async function runExternalAcpAgent(
  options: ExternalAcpRunOptions,
): Promise<ExternalAcpRunResult> {
  try {
    return await withExternalAcpProcess(
      options.config,
      options.signal,
      RUN_TIMEOUT_MS,
      (stream, cwd, signal) => runExternalAcpOverStream(stream, cwd, { ...options, signal }),
    )
  } catch (error) {
    if (options.signal.aborted) return { content: "", toolEvents: [], canceled: true }
    throw error
  }
}

/** 初始化并创建空会话，用于设置页连接诊断；不发送 prompt，也不授予工具权限。 */
export async function probeExternalAcpAgent(
  config: ExternalAgentConfig,
): Promise<ExternalAcpProbeResult> {
  const startedAt = performance.now()
  return withExternalAcpProcess(config, undefined, PROBE_TIMEOUT_MS, async (stream, cwd, signal) =>
    acp.client({ name: "ideall-probe" }).connectWith(stream, async (agent) => {
      const initialized = await agent.request(
        acp.methods.agent.initialize,
        { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} },
        { cancellationSignal: signal },
      )
      await agent.buildSession({ cwd, mcpServers: [] }).withSession(async () => {})
      return {
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
        protocolVersion: initialized.protocolVersion,
      }
    }),
  )
}
