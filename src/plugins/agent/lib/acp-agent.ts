// ACP 智能体方向映射 (Stage 2, 方案 C) —— 把 ideall 自身暴露为【ACP 智能体】, 供外部客户端 (编辑器等) 驱动。
//
// 纯映射层: 把 SDK 的 agent() 处理器 (initialize / session.new / session.prompt) 映射到一个注入的 runTurn
// (一轮内核驱动)。传输无关 (调用方 connect(stream)); 运行时不引内核/Tauri (只引类型), 便于在 node 内做
// 进程内 e2e 单测 (见 acp-agent.test.ts)。生产侧把 runTurn 接到 runAgent 见 acp-expose.ts。
//
// 安全: prompt 一律经注入的 runTurn 进 ideall 内核 (runAgent→connectAgentMcp→agentGrant), 四道安全闸不变。
import type { AgentToolEvent } from "./model"
import type { ContentBlock } from "@agentclientprotocol/sdk"

/** 一轮 prompt 的内核回调钩子 (注入便于测试 / 与 runAgent 解耦)。 */
export interface AcpTurnHooks {
  /** 该轮的取消信号 (来自 ACP 请求; 接到 session/cancel 即 abort)。 */
  signal: AbortSignal
  /** 流式文本增量 (当前 runAgent 非流式, 文本经 runTurn 返回值一次性回送; 预留)。 */
  onText: (text: string) => void
  /** 每次工具调用事件 (映射为 session/update 的 tool_call)。 */
  onToolEvent: (ev: AgentToolEvent) => void
}

/** 驱动 ideall 内核跑一轮 (工具/文本经 hooks 回送); 返回该轮最终文本 (可空)。 */
export type AcpTurnRunner = (prompt: string, hooks: AcpTurnHooks) => Promise<string>

/** 取 ContentBlock[] 里的文本块拼为一段纯文本 (其余类型 MVP 忽略)。 */
function promptText(blocks: readonly ContentBlock[]): string {
  const out: string[] = []
  for (const b of blocks) if (b.type === "text") out.push(b.text)
  return out.join("\n").trim()
}

/**
 * 用官方 SDK 的 agent() 建一个 ideall ACP 智能体 App (尚未接 transport; 调用方 .connect(stream))。
 * @param acp  SDK 命名空间 (生产: await import; 测试: 静态 import 同一单例)。
 * @param runTurn 内核驱动注入 (生产 = runIdeallTurn; 测试 = 假实现)。
 */
export function buildIdeallAcpAgent(
  acp: typeof import("@agentclientprotocol/sdk"),
  runTurn: AcpTurnRunner,
) {
  return acp
    .agent({ name: "ideall" })
    .onRequest(acp.methods.agent.initialize, () => ({
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: {},
    }))
    .onRequest(acp.methods.agent.session.new, () => ({
      sessionId: `ideall-${crypto.randomUUID()}`,
    }))
    .onRequest(acp.methods.agent.session.prompt, async (ctx) => {
      const sessionId = ctx.params.sessionId
      const text = promptText(ctx.params.prompt)
      let toolSeq = 0
      const emitText = (t: string) => {
        if (!t) return
        void ctx.client
          .notify(acp.methods.client.session.update, {
            sessionId,
            update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: t } },
          })
          .catch(() => {})
      }
      try {
        const final = await runTurn(text, {
          signal: ctx.signal,
          onText: emitText,
          onToolEvent: (ev) => {
            void ctx.client
              .notify(acp.methods.client.session.update, {
                sessionId,
                update: {
                  sessionUpdate: "tool_call",
                  toolCallId: `tc-${toolSeq++}`,
                  title: ev.summary || ev.name,
                  status: ev.ok ? "completed" : "failed",
                },
              })
              .catch(() => {})
          },
        })
        // runAgent 非流式: 最终文本在结束时一次性回送。
        emitText(final)
        return { stopReason: ctx.signal.aborted ? "cancelled" : "end_turn" }
      } catch {
        // 内核出错 (未配置 / 网络 / 模型错): 以 refusal 收束本轮, 不崩连接。
        return { stopReason: "refusal" }
      }
    })
}
