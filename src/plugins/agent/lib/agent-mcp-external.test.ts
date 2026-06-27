// 端到端回归: 外部 MCP (SSE) 真连接 + 工具执行 + 审批 gate (无需真实模型/Key)。
// 起两个本地服务: (1) 真实 SSE MCP server (SDK, 暴露 echo 工具); (2) mock OpenAI 兼容端点 (返回预设 tool_call)。
// 直接驱动真实 connectAgentMcp / runAgent 链路, 锁死「不是只显示」: 外部工具真被连上并执行, confirm 拒绝即跳过。
import http from "node:http"
import { test } from "node:test"
import assert from "node:assert/strict"
import { z } from "zod"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js"
import { connectAgentMcp } from "./agent-mcp"
import { runAgent } from "./agent-run"

/** 起一个真实的 SSE MCP server, 暴露 echo 工具 (回显 text); 返回连接 url、调用计数、关闭。 */
async function startEchoSse() {
  const server = new McpServer({ name: "echo-test", version: "1.0.0" })
  let calls = 0
  server.tool("echo", { text: z.string() }, async ({ text }) => {
    calls++
    return { content: [{ type: "text", text: JSON.stringify({ echoed: text }) }] }
  })

  const transports = new Map<string, SSEServerTransport>()
  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1")
    if (req.method === "GET" && url.pathname === "/sse") {
      const t = new SSEServerTransport("/messages", res)
      transports.set(t.sessionId, t)
      res.on("close", () => transports.delete(t.sessionId))
      await server.connect(t) // start() 写 SSE 头 + endpoint event
    } else if (req.method === "POST" && url.pathname === "/messages") {
      const t = transports.get(url.searchParams.get("sessionId") ?? "")
      if (!t) {
        res.statusCode = 404
        res.end()
        return
      }
      let body = ""
      req.on("data", (c) => (body += c))
      req.on("end", () => {
        void t.handlePostMessage(req, res, body ? JSON.parse(body) : undefined)
      })
    } else {
      res.statusCode = 404
      res.end()
    }
  })
  await new Promise<void>((r) => httpServer.listen(0, "127.0.0.1", r))
  const port = (httpServer.address() as { port: number }).port
  return {
    url: `http://127.0.0.1:${port}/sse`,
    getCalls: () => calls,
    async close() {
      httpServer.closeAllConnections?.()
      await new Promise<void>((r) => httpServer.close(() => r()))
    },
  }
}

/** 起一个 mock OpenAI 兼容端点: 按调用次序返回 script 里的响应 (超出用最后一个)。 */
async function startMockLlm(script: unknown[]) {
  let i = 0
  const httpServer = http.createServer((req, res) => {
    let body = ""
    req.on("data", (c) => (body += c))
    req.on("end", () => {
      const resp = script[Math.min(i, script.length - 1)]
      i++
      res.setHeader("Content-Type", "application/json")
      res.end(JSON.stringify(resp))
    })
  })
  await new Promise<void>((r) => httpServer.listen(0, "127.0.0.1", r))
  const port = (httpServer.address() as { port: number }).port
  return {
    baseURL: `http://127.0.0.1:${port}/v1`,
    async close() {
      httpServer.closeAllConnections?.()
      await new Promise<void>((r) => httpServer.close(() => r()))
    },
  }
}

const toolCallResp = {
  choices: [
    {
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "c1",
            type: "function",
            function: { name: "m0_echo", arguments: JSON.stringify({ text: "hi" }) },
          },
        ],
      },
    },
  ],
}
const finalResp = { choices: [{ message: { role: "assistant", content: "完成" } }] }

function externalEcho(url: string) {
  return {
    loopbackEnabled: false as const,
    externalServers: [{ id: "x", name: "Echo", transport: "sse" as const, url }],
  }
}

test("外部 MCP (SSE) 真连接: 列出工具(m0_ 前缀) 且 callTool 真执行", async () => {
  const echo = await startEchoSse()
  const mcp = await connectAgentMcp(externalEcho(echo.url))
  try {
    assert.ok(
      mcp.tools.some((t) => t.function.name === "m0_echo"),
      "外部工具应以 m0_ 前缀暴露给模型",
    )
    const r = await mcp.callTool("m0_echo", { text: "hi" })
    assert.equal(r.ok, true)
    assert.deepEqual(r.data, { echoed: "hi" }, "应拿到外部 server 的真实返回")
    assert.equal(echo.getCalls(), 1, "外部 server 的 echo 工具应被真实调用一次")
  } finally {
    await mcp.close()
    await echo.close()
  }
})

test("runAgent 端到端: 模型调用外部工具 → 真执行 → 最终答复", async () => {
  const echo = await startEchoSse()
  const llm = await startMockLlm([toolCallResp, finalResp])
  try {
    const res = await runAgent({
      baseURL: llm.baseURL,
      model: "x",
      apiKey: "x",
      messages: [{ role: "user", content: "echo hi" }],
      mcp: externalEcho(echo.url),
    })
    assert.equal(echo.getCalls(), 1, "工具应被执行")
    assert.ok(
      res.toolEvents.some((e) => e.name === "m0_echo" && e.ok),
      "工具事件应记录一次成功的外部工具调用",
    )
    assert.equal(res.content, "完成")
  } finally {
    await llm.close()
    await echo.close()
  }
})

test("工具审批 confirm: onApprove 返回 false → 工具被跳过, 不产生副作用", async () => {
  const echo = await startEchoSse()
  const llm = await startMockLlm([toolCallResp, finalResp])
  try {
    const res = await runAgent({
      baseURL: llm.baseURL,
      model: "x",
      apiKey: "x",
      messages: [{ role: "user", content: "echo hi" }],
      mcp: externalEcho(echo.url),
      onApprove: async () => false,
    })
    assert.equal(echo.getCalls(), 0, "拒绝后外部工具不应被执行")
    assert.ok(
      res.toolEvents.some((e) => e.name === "m0_echo" && !e.ok && e.summary.includes("拒绝")),
      "应记录一次被拒绝的工具事件",
    )
    assert.equal(res.content, "完成")
  } finally {
    await llm.close()
    await echo.close()
  }
})
