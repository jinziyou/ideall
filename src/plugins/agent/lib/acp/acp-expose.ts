// ACP 暴露方向 —— 生产侧把 ideall ACP 智能体接到内核 (runAgent) 与运行上下文 (resolveRun)。
//
// 与 acp-agent.ts (纯映射, 可单测) 分离: 本文件引内核 (agent-run) + 设置 + home 上下文 (重依赖, 运行时才用),
// 不入纯映射的单测链。真实入站连接由 Rust loopback 监听器提供，boot 时按本机设置启停并把
// socket Stream 交给 exposeIdeallAcpAgent。
//
// 注: 暴露方向是 headless —— 不注入"当前查看的节点"(gatherReferencedContext, UI 概念); 仅用 home 快照 (仅标题)。
import type { Stream } from "@agentclientprotocol/sdk"
import type { ConnectAgentOpts } from "../agent-mcp"
import { runAgent } from "../agent-run"
import {
  appendAgentWriteAuditViaFileSystem,
  completeAgentWriteAuditViaFileSystem,
} from "../agent-write-audit-client"
import { hydrateAgentSettingsSecure, isConfigured } from "../agent-settings"
import { gatherHomeContext, buildSystemPrompt } from "../agent-context"
import { buildIdeallAcpAgent, type AcpTurnRunner } from "./acp-agent"
import {
  acpListenStart,
  acpListenStop,
  acpServerClose,
  createServerStream,
  onAcpServerClosed,
  onAcpServerOpen,
} from "@/lib/acp-transport"
import { bumpAcpConnections, setAcpServerStatus } from "./acp-status"
import { getAcpSettings } from "./acp-settings"
import { isTauri } from "@/lib/tauri"

/** 一次 ACP 提示运行所需的解析结果 (工作区提供: 模型 + 系统提示 + 能力收窄), 与 AgentPanel 的 ResolvedRun 同构。 */
export interface AcpRunContext {
  baseURL: string
  model: string
  apiKey: string
  system: string
  mcp?: ConnectAgentOpts
}

/** 无 React, 从本地设置 + home 快照 (仅标题) 组装运行上下文; 未配置模型/Key 返回 null。 */
export async function resolveRun(): Promise<AcpRunContext | null> {
  const s = await hydrateAgentSettingsSecure()
  if (!isConfigured(s)) return null
  const home = s.includeHomeContext ? await gatherHomeContext().catch(() => "") : ""
  // 暴露方向 = 智能体模式 (tools on)。
  const system = buildSystemPrompt(home, { tools: true })
  return { baseURL: s.baseURL, model: s.model, apiKey: s.apiKey, system, mcp: {} }
}

/** 把一轮 ACP prompt 映射到 ideall 内核 (runAgent → connectAgentMcp → agentGrant, 四道闸不变)。 */
export const runIdeallTurn: AcpTurnRunner = async (prompt, hooks) => {
  const run = await resolveRun()
  if (!run) throw new Error("agent-not-configured: 请先在设置里配置模型与 API Key")
  const { content } = await runAgent({
    baseURL: run.baseURL,
    model: run.model,
    apiKey: run.apiKey,
    messages: [
      { role: "system", content: run.system },
      { role: "user", content: prompt },
    ],
    signal: hooks.signal,
    onToolEvent: hooks.onToolEvent,
    mcp: run.mcp,
    onToolIntent: async (preview) =>
      appendAgentWriteAuditViaFileSystem({
        source: "tool",
        operation: preview.toolName,
        title: preview.title,
        summary: "已批准，等待执行",
        status: "pending",
        effect: preview.effect,
        risk: preview.risk,
        ...(preview.target ? { target: preview.target } : {}),
      }),
    onToolAudit: async ({ preview, status, summary, auditId }) => {
      if (auditId && status !== "rejected") {
        await completeAgentWriteAuditViaFileSystem({ id: auditId, status, summary })
        return
      }
      await appendAgentWriteAuditViaFileSystem({
        source: "tool",
        operation: preview.toolName,
        title: preview.title,
        summary,
        status,
        effect: preview.effect,
        risk: preview.risk,
        ...(preview.target ? { target: preview.target } : {}),
      })
    },
  })
  return content
}

/** 把 ideall 暴露为 ACP 智能体并接到一条 Stream (由 transport 提供); 返回 AgentConnection。 */
export async function exposeIdeallAcpAgent(stream: Stream) {
  const acp = await import("@agentclientprotocol/sdk")
  return buildIdeallAcpAgent(acp, runIdeallTurn).connect(stream)
}

// —— 暴露服务端生命周期 (入站: 编辑器连入) ——
// 进程内单例: 监听 loopback, 每个入站连接 attach 一个 ideall ACP 智能体。由设置开关 enable/disable 驱动。

interface AcpServerHandle {
  port: number
  stop: () => Promise<void>
}

async function startAcpServer(port?: number): Promise<AcpServerHandle> {
  const conns = new Map<string, () => void>()

  // 先注册监听再开始 accept, 避免漏掉首个连接。
  const unOpen = await onAcpServerOpen((connId) => {
    void (async () => {
      const { stream, dispose } = await createServerStream(connId)
      conns.set(connId, dispose)
      bumpAcpConnections(1)
      try {
        await exposeIdeallAcpAgent(stream) // 连接收束时 AgentConnection 自然结束
      } catch {
        dispose()
        conns.delete(connId)
        bumpAcpConnections(-1)
        await acpServerClose(connId).catch(() => {})
      }
    })()
  })
  const unClosed = await onAcpServerClosed((connId) => {
    const dispose = conns.get(connId)
    if (dispose) {
      dispose()
      conns.delete(connId)
      bumpAcpConnections(-1)
    }
  })

  const bound = await acpListenStart(port)
  return {
    port: bound,
    stop: async () => {
      unOpen()
      unClosed()
      for (const dispose of conns.values()) dispose()
      conns.clear()
      await acpListenStop().catch(() => {})
    },
  }
}

let serverHandle: AcpServerHandle | null = null

/** 开启暴露服务端 (允许编辑器连入); 返回监听端口。重复调用先关旧的。仅 App 桌面可用 (非 Tauri 抛)。 */
export async function enableAcpServer(port?: number): Promise<number> {
  if (serverHandle) await disableAcpServer()
  serverHandle = await startAcpServer(port)
  setAcpServerStatus({ listening: true, port: serverHandle.port, connections: 0 })
  return serverHandle.port
}

/** 关闭暴露服务端并断开所有入站连接。幂等。 */
export async function disableAcpServer(): Promise<void> {
  const h = serverHandle
  serverHandle = null
  if (h) await h.stop()
  setAcpServerStatus({ listening: false, port: null, connections: 0 })
}

/** 暴露服务端是否已开启。 */
export function isAcpServerOn(): boolean {
  return serverHandle !== null
}

/** 暴露方向「一键自测」结果。 */
export interface ExposeSelfTestResult {
  ok: boolean
  port?: number
  updates?: number
  stopReason?: string
  text?: string
  error?: string
}

/**
 * 暴露方向自测: 确保监听开启 → 拉起内置 selftest 客户端经 TCP 连回本机端口 → 跑 initialize/prompt →
 * 收到 stopReason 即证明"被编辑器驱动"整条链路通 (即便未配模型, stopReason 可能是 refusal, 仍算链路通)。
 * 仅 App 桌面可用。
 */
export async function runExposeSelfTest(port?: number): Promise<ExposeSelfTestResult> {
  if (!isTauri()) return { ok: false, error: "仅 App 桌面可用" }
  const { invoke } = await import("@tauri-apps/api/core")
  let boundPort: number
  try {
    boundPort = await enableAcpServer(port)
  } catch (e) {
    return { ok: false, error: "监听启动失败：" + (e instanceof Error ? e.message : String(e)) }
  }
  const script = await invoke<string | null>("acp_script_path", {
    name: "acp-selftest-client.mjs",
  })
  if (!script) return { ok: false, port: boundPort, error: "自测脚本未找到（仅 dev 态可用）" }
  let out: string
  try {
    out = await invoke<string>("acp_run_once", {
      program: "node",
      args: [script, "--port", String(boundPort)],
      timeoutMs: 20000,
    })
  } catch (e) {
    return {
      ok: false,
      port: boundPort,
      error: "运行自测客户端失败：" + (e instanceof Error ? e.message : String(e)),
    }
  }
  const line = out.trim().split("\n").filter(Boolean).pop() ?? ""
  try {
    const r = JSON.parse(line) as ExposeSelfTestResult
    return { ...r, port: boundPort }
  } catch {
    return { ok: false, port: boundPort, error: "无法解析自测结果：" + line.slice(0, 120) }
  }
}

/** 据持久化设置自启动暴露监听 (App 启动时调; 仅桌面 + 已开启 + 未在运行; 失败静默)。 */
export async function autostartAcpServerFromSettings(): Promise<void> {
  if (!isTauri() || isAcpServerOn()) return
  if (!getAcpSettings().allowEditorConnect) return
  try {
    await enableAcpServer(getAcpSettings().listenPort || undefined)
  } catch {
    // 端口被占 / 监听失败: 静默, 用户可在设置里重试。
  }
}
