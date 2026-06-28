import { test } from "node:test"
import assert from "node:assert/strict"
import * as acp from "@agentclientprotocol/sdk"
import { buildIdeallAcpAgent, type AcpTurnRunner } from "./acp-agent"

// 进程内 e2e: 用 SDK 的 client().connectWith(agentApp, ...) 直接驱动 ideall ACP 智能体 (无 Tauri/网络/LLM),
// 注入假 runTurn, 断言 prompt 文本透传内核、工具/文本回送为 session/update、收 end_turn。
test("ACP 暴露: prompt→内核, 工具/文本回送为 session/update, 收 end_turn", async () => {
  const fakeRun: AcpTurnRunner = async (prompt, hooks) => {
    assert.equal(prompt, "你好")
    hooks.onToolEvent({ name: "fs.list", argsText: "{}", ok: true, summary: "已列出 3 个项目" })
    return "已处理：" + prompt
  }
  const agentApp = buildIdeallAcpAgent(acp, fakeRun)

  const out = await acp
    .client({ name: "test-client" })
    .onRequest(acp.methods.client.session.requestPermission, () => ({
      outcome: { outcome: "cancelled" },
    }))
    .connectWith(agentApp, async (cx) => {
      const init = await cx.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
      })
      return cx.buildSession("/tmp/ideall-acp-test").withSession(async (s) => {
        const updates: acp.SessionUpdate[] = []
        s.prompt("你好").catch(() => {})
        for (;;) {
          const msg = await s.nextUpdate()
          if (msg.kind === "stop") return { init, stopReason: msg.stopReason, updates }
          updates.push(msg.update)
        }
      })
    })

  assert.equal(out.init.protocolVersion, acp.PROTOCOL_VERSION)
  assert.equal(out.stopReason, "end_turn")
  assert.ok(
    out.updates.some((u) => u.sessionUpdate === "tool_call"),
    "应回送 tool_call 更新",
  )
  assert.ok(
    out.updates.some((u) => u.sessionUpdate === "agent_message_chunk"),
    "应回送 agent_message_chunk 文本更新",
  )
})

test("session/new 每次返回唯一 sessionId", async () => {
  const fakeRun: AcpTurnRunner = async () => ""
  const agentApp = buildIdeallAcpAgent(acp, fakeRun)
  const ids = await acp
    .client({ name: "test-client" })
    .onRequest(acp.methods.client.session.requestPermission, () => ({
      outcome: { outcome: "cancelled" },
    }))
    .connectWith(agentApp, async (cx) => {
      await cx.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
      })
      const a = await cx.request(acp.methods.agent.session.new, { cwd: "/tmp/a", mcpServers: [] })
      const b = await cx.request(acp.methods.agent.session.new, { cwd: "/tmp/b", mcpServers: [] })
      return [a.sessionId, b.sessionId]
    })
  assert.notEqual(ids[0], ids[1])
})
