#!/usr/bin/env node
// 最小 stdio ACP echo agent —— 测试对端: 把收到的 prompt 原样回显 (含一个示例 tool_call),
// 用于验证 ideall「客户端方向」(AI 工作区 → 外部智能体) 端到端连通, 无需任何外部凭证。
//
// 用官方 @agentclientprotocol/sdk 的 agent() over stdio(NDJSON)。本侧(agent)从自己的 stdin 读、向自己的 stdout 写。
//
// 在 ideall 设置「外部智能体」里这样填:
//   程序   : node
//   参数   : <本仓库绝对路径>/scripts/acp-echo-agent.mjs
//   工作目录: 任意(可留空; 模块解析按脚本位置走, 不依赖 cwd)
//
// 重要: ACP 规定 agent 的 stdout 只能是协议消息 —— 故本脚本所有日志一律走 stderr(console.error)。
import { Readable, Writable } from "node:stream"
import * as acp from "@agentclientprotocol/sdk"

const log = (...a) => console.error("[echo-agent]", ...a)

// ndJsonStream(out, in): 出站写 stdout, 入站读 stdin。
const stream = acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin))

let seq = 0

const app = acp
  .agent({ name: "echo-agent" })
  .onRequest(acp.methods.agent.initialize, (ctx) => {
    log("initialize; client protocolVersion =", ctx.params.protocolVersion)
    return { protocolVersion: acp.PROTOCOL_VERSION, agentCapabilities: {} }
  })
  .onRequest(acp.methods.agent.session.new, () => {
    const sessionId = `echo-${++seq}`
    log("session/new ->", sessionId)
    return { sessionId }
  })
  .onRequest(acp.methods.agent.session.prompt, async (ctx) => {
    const { sessionId, prompt } = ctx.params
    const text = prompt
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
    log("session/prompt:", JSON.stringify(text))

    const send = (update) =>
      ctx.client.notify(acp.methods.client.session.update, { sessionId, update })

    // 1) 示例工具调用 (验证 ideall 工具事件渲染)。
    await send({
      sessionUpdate: "tool_call",
      toolCallId: `tc-${seq}`,
      title: "echo 回显工具",
      status: "completed",
    })
    // 2) 回显文本, 分两块发出 (验证 ideall 流式累积)。
    await send({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "echo: " } })
    await send({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: text || "(空消息)" },
    })

    return { stopReason: "end_turn" }
  })

const conn = app.connect(stream)
log("ready on stdio; waiting for client…")
await conn.closed
log("connection closed; exiting")
