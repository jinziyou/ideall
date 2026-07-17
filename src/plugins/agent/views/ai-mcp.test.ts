import assert from "node:assert/strict"
import { test } from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import type { McpConnectionDiagnostic } from "../lib/agent-mcp-diagnostics"
import { runStatusOf, type McpServer } from "../lib/agent-mcp-registry"
import { McpDiagnosticSummary } from "./ai-mcp"

const server: McpServer = {
  id: "mcp-1",
  name: "Example",
  transport: "http",
  command: "",
  args: "",
  url: "https://example.test/mcp",
  env: [],
  headers: [],
  auth: "none",
  enabled: true,
  builtin: false,
  createdAt: 1,
  updatedAt: 7,
}

function diagnostic(patch: Partial<McpConnectionDiagnostic> = {}): McpConnectionDiagnostic {
  return {
    serverId: "mcp-1",
    transport: "http",
    configRevision: 7,
    status: "healthy",
    activeSessions: 0,
    checkedAt: 100,
    durationMs: 25,
    toolCount: 2,
    failure: null,
    lastCall: null,
    ...patch,
  }
}

test("MCP settings status ignores stale diagnostics and maps current health consistently", () => {
  assert.equal(runStatusOf(server, diagnostic()), "connected")
  assert.equal(runStatusOf(server, diagnostic({ status: "checking" })), "connecting")
  assert.equal(runStatusOf(server, diagnostic({ status: "degraded" })), "degraded")
  assert.equal(runStatusOf(server, diagnostic({ status: "error" })), "error")
  assert.equal(runStatusOf(server, diagnostic({ configRevision: 6 })), "pending")
  assert.equal(runStatusOf({ ...server, enabled: false }, diagnostic()), "disabled")
})

test("MCP settings diagnostic renders bounded metadata without connection secrets", () => {
  const html = renderToStaticMarkup(
    createElement(McpDiagnosticSummary, {
      diagnostic: diagnostic({
        status: "degraded",
        activeSessions: 1,
        failure: {
          kind: "unavailable",
          code: "service-unavailable",
          message: "MCP 服务不可达",
        },
        lastCall: {
          toolName: "echo",
          status: "transport-error",
          startedAt: 120,
          finishedAt: 150,
          durationMs: 30,
        },
      }),
    }),
  )
  assert.match(html, /连接已降级/)
  assert.match(html, /service-unavailable/)
  assert.match(html, /echo/)
  assert.match(html, /不记录 URL、命令参数、请求头、工具参数或返回正文/)
  assert.doesNotMatch(html, /Bearer|token=|Authorization/)
})
