// 客户端 agent 工具循环 —— 反复调用模型, 执行其 tool_calls (经统一 fs.*/ui.* 能力层), 直到产出最终答复。
// 智能体模式专用 (非流式)。普通对话仍走 streamChat。
// §6.4: 工具来自 agent 的 LoopbackTransport MCP 会话 (与 iframe 同一条 Grant→createLocalMcpServer 链路),
// AGENT_TOOLS→tools/list、executeTool→callTool; 隐私/权限 gate 与 iframe 完全一致。
import { requestCompletion } from "./agent-chat"
import { connectAgentMcp, summarizeTool, type ConnectAgentOpts } from "./agent-mcp"
import type { AgentToolEvent } from "./model"
import { TOOL } from "@/plugins/embed/protocol"

const MAX_ROUNDS = 8

const FORCE_APPROVAL_TOOLS = new Set<string>([
  TOOL.fsCreate,
  TOOL.fsWrite,
  TOOL.fsMove,
  TOOL.fsDelete,
  TOOL.uiOpenTab,
  TOOL.uiCloseTab,
  TOOL.browserNavigate,
  TOOL.browserClick,
  TOOL.browserFill,
  TOOL.browserPress,
  TOOL.browserWait,
  TOOL.browserWaitForSelector,
])

export interface RunAgentOptions {
  baseURL: string
  model: string
  apiKey: string
  /** 已含 system + 历史对话 (role/content) 的初始消息 */
  messages: { role: string; content: string }[]
  signal?: AbortSignal
  /** 每执行一个工具回调一次 (用于实时展示) */
  onToolEvent?: (ev: AgentToolEvent) => void
  /** 工作区能力收窄 (能力位子集 / 工具白名单); 缺省 = 全部默认能力。 */
  mcp?: ConnectAgentOpts
  /** 工具审批 (approvalPolicy==="confirm" 时由 UI 提供): 每次执行工具前征询, 返回 false → 跳过该工具。 */
  onApprove?: (name: string, argsText: string) => Promise<boolean>
  /** confirm=全部工具确认; auto=仅危险/外部工具强制确认。缺省保持旧行为: 传了 onApprove 就全部确认。 */
  approvalPolicy?: "confirm" | "auto"
}

export interface RunAgentResult {
  content: string
  toolEvents: AgentToolEvent[]
  canceled?: boolean
}

function shorten(raw: string): string {
  const s = (raw ?? "").trim()
  return s.length > 120 ? s.slice(0, 120) + "…" : s
}

function requiresApproval(name: string): boolean {
  return FORCE_APPROVAL_TOOLS.has(name) || /^m\d+_/.test(name)
}

function pushToolEvent(
  events: AgentToolEvent[],
  ev: AgentToolEvent,
  onToolEvent?: (ev: AgentToolEvent) => void,
): void {
  events.push(ev)
  onToolEvent?.(ev)
}

/** 运行一轮智能体 (可含多次工具调用), 返回最终文本与工具事件。出错抛异常 (abort 抛 AbortError)。 */
export async function runAgent(opts: RunAgentOptions): Promise<RunAgentResult> {
  // 工作消息序列 (含 tool_calls / tool 结果), 仅本轮内存使用, 不持久化
  const messages: unknown[] = [...opts.messages]
  const toolEvents: AgentToolEvent[] = []
  // 起 loopback MCP 会话 (与 iframe 同一能力层); finally 释放端口。
  const mcp = await connectAgentMcp(opts.mcp)
  try {
    for (const d of mcp.diagnostics) {
      pushToolEvent(
        toolEvents,
        {
          name: `mcp:${d.serverName}`,
          argsText: "",
          ok: d.ok,
          summary: d.ok
            ? `MCP 已连接：${d.serverName}`
            : `MCP 不可用：${d.serverName}（${shorten(d.message)}）`,
        },
        opts.onToolEvent,
      )
    }

    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (opts.signal?.aborted) return { content: "", toolEvents, canceled: true }
      const msg = await requestCompletion({
        baseURL: opts.baseURL,
        model: opts.model,
        apiKey: opts.apiKey,
        messages,
        tools: mcp.tools,
        signal: opts.signal,
      })

      const toolCalls = msg.tool_calls ?? []
      if (toolCalls.length === 0) {
        return { content: msg.content ?? "", toolEvents }
      }

      // 回放 assistant 的 tool_calls (OpenAI 要求后续 tool 结果与之配对)
      messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: toolCalls })

      for (const tc of toolCalls) {
        // 用户中途「停止」: 不再执行后续工具, 把副作用限制在已发起的这一个之内
        if (opts.signal?.aborted) return { content: "", toolEvents, canceled: true }
        const apiName = tc.function.name
        const mcpName = mcp.resolveToolName(apiName)
        let args: Record<string, unknown>
        try {
          args = JSON.parse(tc.function.arguments || "{}")
        } catch {
          const ev: AgentToolEvent = {
            name: mcpName,
            argsText: shorten(tc.function.arguments),
            ok: false,
            summary: "工具参数不是合法 JSON，已跳过执行",
          }
          pushToolEvent(toolEvents, ev, opts.onToolEvent)
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify({ ok: false, summary: ev.summary }),
          })
          continue
        }
        // 工具审批 (confirm 策略): 执行前征询用户; 拒绝 → 把「已拒绝」喂回模型, 不执行副作用。
        if (
          opts.onApprove &&
          ((opts.approvalPolicy ?? "confirm") === "confirm" ||
            requiresApproval(mcpName)) &&
          !(await opts.onApprove(mcpName, tc.function.arguments || ""))
        ) {
          const ev: AgentToolEvent = {
            name: mcpName,
            argsText: shorten(tc.function.arguments),
            ok: false,
            summary: "已拒绝执行",
          }
          pushToolEvent(toolEvents, ev, opts.onToolEvent)
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify({ ok: false, summary: "用户拒绝执行该工具" }),
          })
          continue
        }
        const { ok, data } = await mcp.callTool(apiName, args)
        const summary = summarizeTool(mcpName, ok, data)
        const ev: AgentToolEvent = {
          name: mcpName,
          argsText: shorten(tc.function.arguments),
          ok,
          summary,
        }
        pushToolEvent(toolEvents, ev, opts.onToolEvent)
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify({ ok, summary, data }),
        })
      }
    }

    // 触及工具调用上限: 不再带 tools, 让模型基于已有结果给最终答复。
    // 但若用户恰在最后一轮结束时「停止」, 不应再发起这次收尾请求 (与循环内 abort 守卫一致)。
    if (opts.signal?.aborted) return { content: "", toolEvents, canceled: true }
    const final = await requestCompletion({
      baseURL: opts.baseURL,
      model: opts.model,
      apiKey: opts.apiKey,
      messages: [
        ...messages,
        { role: "user", content: "请基于以上工具结果，用简洁中文给出最终答复，不要再调用工具。" },
      ],
      signal: opts.signal,
    })
    return {
      content: final.content?.trim() || "（已达到工具调用上限，请缩小任务范围后重试）",
      toolEvents,
    }
  } finally {
    await mcp.close()
  }
}
