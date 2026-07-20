import assert from "node:assert/strict"
import { test } from "node:test"
import * as acp from "@agentclientprotocol/sdk"
import type { AgentApp, AnyMessage, Stream } from "@agentclientprotocol/sdk"
import {
  buildExternalAcpPrompt,
  parseExternalAgentArgs,
  runExternalAcpOverStream,
  type ExternalAcpPermissionAuditEvent,
} from "./acp-client"

function connectAgent(agent: AgentApp): { stream: Stream; close: () => void } {
  const clientToAgent = new TransformStream<AnyMessage, AnyMessage>()
  const agentToClient = new TransformStream<AnyMessage, AnyMessage>()
  const connection = agent.connect({
    readable: clientToAgent.readable,
    writable: agentToClient.writable,
  })
  return {
    stream: { readable: agentToClient.readable, writable: clientToAgent.writable },
    close: () => connection.close(),
  }
}

test("external ACP argv parser: quoted arguments without shell expansion", () => {
  assert.deepEqual(parseExternalAgentArgs("--mode \"safe mode\" --name 'ideall agent'"), [
    "--mode",
    "safe mode",
    "--name",
    "ideall agent",
  ])
  assert.deepEqual(parseExternalAgentArgs("--literal $HOME"), ["--literal", "$HOME"])
  assert.deepEqual(parseExternalAgentArgs("--config C:\\Users\\me\\agent.json"), [
    "--config",
    "C:\\Users\\me\\agent.json",
  ])
  assert.throws(() => parseExternalAgentArgs("--mode 'unterminated"), /未闭合/u)
})

test("external ACP prompt: keeps roles and applies a total bound", () => {
  const prompt = buildExternalAcpPrompt([
    { role: "system", content: "只回答事实" },
    { role: "user", content: "你好" },
  ])
  assert.match(prompt, /【系统】\n只回答事实/u)
  assert.match(prompt, /【用户】\n你好/u)
  assert.ok(prompt.length <= 512 * 1024)
})

test("external ACP session: streams text, confirms permission, and settles audit", async () => {
  let newSessionRequest: unknown
  let permissionOutcome = ""
  const agent = acp
    .agent({ name: "test-external-agent" })
    .onRequest(acp.methods.agent.initialize, (context) => ({
      protocolVersion: context.params.protocolVersion,
      agentCapabilities: {},
    }))
    .onRequest(acp.methods.agent.session.new, (context) => {
      newSessionRequest = context.params
      return { sessionId: "external-test-session" }
    })
    .onRequest(acp.methods.agent.session.prompt, async (context) => {
      await context.client.notify(acp.methods.client.session.update, {
        sessionId: context.params.sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "tool-1",
          title: "写入测试文件",
          kind: "edit",
          status: "pending",
        },
      })
      const permission = await context.client.request(
        acp.methods.client.session.requestPermission,
        {
          sessionId: context.params.sessionId,
          toolCall: {
            toolCallId: "tool-1",
            title: "写入测试文件",
            kind: "edit",
            rawInput: { content: "secret body", apiKey: "secret" },
            locations: [{ path: "/private/test.md", line: 1 }],
          },
          options: [
            { optionId: "reject", name: "拒绝", kind: "reject_once" },
            { optionId: "allow", name: "允许一次", kind: "allow_once" },
          ],
        },
      )
      permissionOutcome = permission.outcome.outcome
      if (permission.outcome.outcome === "selected") {
        await context.client.notify(acp.methods.client.session.update, {
          sessionId: context.params.sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "tool-1",
            status: "completed",
          },
        })
      }
      await context.client.notify(acp.methods.client.session.update, {
        sessionId: context.params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "完成" },
        },
      })
      return { stopReason: "end_turn" }
    })
  const transport = connectAgent(agent)
  const audits: ExternalAcpPermissionAuditEvent[] = []
  const updates: string[] = []

  try {
    const result = await runExternalAcpOverStream(transport.stream, "/workspace", {
      messages: [{ role: "user", content: "执行任务" }],
      signal: new AbortController().signal,
      allowPermissions: true,
      onApprove: async (preview) => {
        assert.equal(preview.risk, "high")
        assert.equal(preview.effect, "external")
        assert.doesNotMatch(JSON.stringify(preview), /secret body|apiKey|private\/test/u)
        return true
      },
      onPermissionIntent: async () => "audit-1",
      onPermissionAudit: async (event) => void audits.push(event),
      onUpdate: (content) => void updates.push(content),
    })

    assert.equal((newSessionRequest as { cwd: string }).cwd, "/workspace")
    assert.deepEqual((newSessionRequest as { mcpServers: unknown[] }).mcpServers, [])
    assert.equal(permissionOutcome, "selected")
    assert.equal(result.content, "完成")
    assert.equal(result.canceled, false)
    assert.equal(result.stopReason, "end_turn")
    assert.equal(result.toolEvents[0]?.ok, true)
    assert.equal(result.toolEvents[0]?.summary, "已完成")
    assert.deepEqual(updates.at(-1), "完成")
    assert.deepEqual(
      audits.map((event) => ({ id: event.auditId, status: event.status })),
      [{ id: "audit-1", status: "committed" }],
    )
  } finally {
    transport.close()
  }
})

test("external ACP session: normal chat rejects permission without showing approval", async () => {
  let approvalCalled = false
  const agent = acp
    .agent({ name: "permission-reject-agent" })
    .onRequest(acp.methods.agent.initialize, (context) => ({
      protocolVersion: context.params.protocolVersion,
      agentCapabilities: {},
    }))
    .onRequest(acp.methods.agent.session.new, () => ({ sessionId: "reject-session" }))
    .onRequest(acp.methods.agent.session.prompt, async (context) => {
      const permission = await context.client.request(
        acp.methods.client.session.requestPermission,
        {
          sessionId: context.params.sessionId,
          toolCall: { toolCallId: "tool-denied", title: "运行命令", kind: "execute" },
          options: [{ optionId: "allow", name: "允许", kind: "allow_once" }],
        },
      )
      assert.equal(permission.outcome.outcome, "cancelled")
      await context.client.notify(acp.methods.client.session.update, {
        sessionId: context.params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "权限已拒绝" },
        },
      })
      return { stopReason: "end_turn" }
    })
  const transport = connectAgent(agent)
  const audits: ExternalAcpPermissionAuditEvent[] = []
  try {
    const result = await runExternalAcpOverStream(transport.stream, "/workspace", {
      messages: [{ role: "user", content: "不要使用工具" }],
      signal: new AbortController().signal,
      allowPermissions: false,
      onApprove: async () => {
        approvalCalled = true
        return true
      },
      onPermissionAudit: async (event) => void audits.push(event),
    })
    assert.equal(approvalCalled, false)
    assert.equal(result.content, "权限已拒绝")
    assert.deepEqual(
      audits.map((event) => event.status),
      ["rejected"],
    )
  } finally {
    transport.close()
  }
})

test("external ACP session: cancellation reaches the prompt handler", async () => {
  let promptStarted!: () => void
  const started = new Promise<void>((resolve) => {
    promptStarted = resolve
  })
  const agent = acp
    .agent({ name: "cancel-agent" })
    .onRequest(acp.methods.agent.initialize, (context) => ({
      protocolVersion: context.params.protocolVersion,
      agentCapabilities: {},
    }))
    .onRequest(acp.methods.agent.session.new, () => ({ sessionId: "cancel-session" }))
    .onRequest(acp.methods.agent.session.prompt, async (context) => {
      promptStarted()
      await new Promise<void>((resolve) => {
        if (context.signal.aborted) resolve()
        else context.signal.addEventListener("abort", () => resolve(), { once: true })
      })
      return { stopReason: "cancelled" }
    })
  const transport = connectAgent(agent)
  const controller = new AbortController()
  try {
    const pending = runExternalAcpOverStream(transport.stream, "/workspace", {
      messages: [{ role: "user", content: "等待" }],
      signal: controller.signal,
      allowPermissions: false,
    })
    await started
    controller.abort()
    const result = await pending
    assert.equal(result.canceled, true)
  } finally {
    transport.close()
  }
})
