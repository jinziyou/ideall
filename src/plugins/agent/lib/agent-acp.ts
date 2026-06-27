// ACP (Agent Client Protocol) 适配「干净接缝」—— 只锁定边界 (传输 + 会话映射), 暂不接入实际传输。
//
// 设计意图: 把 ideall 工作区智能体经 ACP 暴露给外部客户端 (编辑器等), 或反向驱动外部 ACP 智能体。
// 现状: 仓库无 ACP、无外部传输 (仅进程内 loopback MCP + OpenAI 兼容 chat; 见 agent-mcp/agent-run)。
// 本文件先把接口钉死, 让后续接入传输时只需把 ACP 的 session/new、session/prompt、session/cancel
// 映射到 resolveRun→runAgent、并把 connectAgentMcp 的工具表作为 ACP 工具暴露, 无需改动内核。
//
// 与 embed/transport 的 MessagePortTransport / LoopbackTransport 并列: 那是 MCP-over-postMessage 的传输;
// ACP 是另一套「客户端↔智能体」协议, 需各自的 transport 实现 (stdio / loopback / websocket)。

import type { ConnectAgentOpts } from "./agent-mcp"

/** ACP 接入状态 (UI 指示位)。 */
export type AcpStatus = "unavailable" | "connecting" | "connected"

/** 当前 ACP 接入状态: 传输未实现 → 始终 unavailable (接缝预留)。 */
export const ACP_STATUS: AcpStatus = "unavailable"

/** ACP 传输边界 —— 接入 stdio / loopback / websocket 时实现此接口。 */
export interface AcpTransport {
  send(message: unknown): void
  onMessage(handler: (message: unknown) => void): void
  close(): Promise<void>
}

/** 一次 ACP 提示运行所需的解析结果 (由工作区提供: 模型 + 系统提示 + 能力收窄), 与 AgentPanel 的 ResolvedRun 同构。 */
export interface AcpRunContext {
  baseURL: string
  model: string
  apiKey: string
  system: string
  mcp?: ConnectAgentOpts
}

/** ACP 适配桥: 把 ACP 会话方法映射到内核 (runAgent + connectAgentMcp)。 */
export interface AcpAgentBridge {
  /** 启动会话循环 (绑定 transport 入站消息)。 */
  start(): Promise<void>
  /** 取消进行中的提示。 */
  cancel(): void
  close(): Promise<void>
}

/**
 * 创建 ACP 适配桥 —— 接缝预留: 传输与 JSON-RPC 方法映射尚未实现。
 * 接入时在此把 ACP 的 session/new、session/prompt、session/cancel 映射到 resolveRun→runAgent,
 * 并把 connectAgentMcp 的工具表作为 ACP 工具暴露。当前调用会抛出, 提示尚未接入。
 */
export function createAcpAgentBridge(
  transport: AcpTransport,
  resolveRun: (useAgent: boolean) => Promise<AcpRunContext | null>,
): AcpAgentBridge {
  // 引用形参以满足接缝完整性 (实现接入时替换为真正的会话循环)。
  void transport
  void resolveRun
  throw new Error("ACP 传输尚未接入 (接缝预留); 见 agent-acp.ts")
}
