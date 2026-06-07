// 客户端 agent 工具循环 —— 反复调用模型, 执行其 tool_calls (本地 IndexedDB), 直到产出最终答复。
// 智能体模式专用 (非流式)。普通对话仍走 streamChat。
import { requestCompletion } from "./agent-chat"
import { AGENT_TOOLS, executeTool } from "./agent-tools"
import type { AgentToolEvent } from "../model"

const MAX_ROUNDS = 8

export interface RunAgentOptions {
  baseURL: string
  model: string
  apiKey: string
  /** 已含 system + 历史对话 (role/content) 的初始消息 */
  messages: { role: string; content: string }[]
  signal?: AbortSignal
  /** 每执行一个工具回调一次 (用于实时展示) */
  onToolEvent?: (ev: AgentToolEvent) => void
}

export interface RunAgentResult {
  content: string
  toolEvents: AgentToolEvent[]
}

function shorten(raw: string): string {
  const s = (raw ?? "").trim()
  return s.length > 120 ? s.slice(0, 120) + "…" : s
}

/** 运行一轮智能体 (可含多次工具调用), 返回最终文本与工具事件。出错抛异常 (abort 抛 AbortError)。 */
export async function runAgent(opts: RunAgentOptions): Promise<RunAgentResult> {
  // 工作消息序列 (含 tool_calls / tool 结果), 仅本轮内存使用, 不持久化
  const messages: unknown[] = [...opts.messages]
  const toolEvents: AgentToolEvent[] = []

  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (opts.signal?.aborted) return { content: "", toolEvents }
    const msg = await requestCompletion({
      baseURL: opts.baseURL,
      model: opts.model,
      apiKey: opts.apiKey,
      messages,
      tools: AGENT_TOOLS,
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
      if (opts.signal?.aborted) return { content: "", toolEvents }
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(tc.function.arguments || "{}")
      } catch {
        args = {}
      }
      const result = await executeTool(tc.function.name, args)
      const ev: AgentToolEvent = {
        name: tc.function.name,
        argsText: shorten(tc.function.arguments),
        ok: result.ok,
        summary: result.summary,
      }
      toolEvents.push(ev)
      opts.onToolEvent?.(ev)
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify({ ok: result.ok, summary: result.summary, data: result.data }),
      })
    }
  }

  // 触及工具调用上限: 不再带 tools, 让模型基于已有结果给最终答复
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
}
