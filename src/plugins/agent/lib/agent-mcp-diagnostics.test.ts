import assert from "node:assert/strict"
import { test } from "node:test"
import {
  beginMcpConnection,
  beginMcpToolCall,
  clearMcpDiagnostics,
  completeMcpConnection,
  completeMcpToolCall,
  diagnosticForMcpServer,
  failMcpConnection,
  getMcpDiagnostics,
  safeMcpFailure,
  subscribeMcpDiagnostics,
} from "./agent-mcp-diagnostics"

test("MCP diagnostics track connection, active session and last call without payloads", () => {
  clearMcpDiagnostics()
  const target = { serverId: "mcp-1", transport: "http" as const, configRevision: 7 }
  const attempt = beginMcpConnection(target, 100)
  assert.equal(getMcpDiagnostics()[0]?.status, "checking")
  const release = completeMcpConnection(attempt, { toolCount: 3, active: true }, 145)
  assert.deepEqual(diagnosticForMcpServer("mcp-1", 7), {
    serverId: "mcp-1",
    transport: "http",
    configRevision: 7,
    status: "connected",
    activeSessions: 1,
    checkedAt: 145,
    durationMs: 45,
    toolCount: 3,
    failure: null,
    lastCall: null,
  })

  const call = beginMcpToolCall(target, "echo\nsecret", 200)
  completeMcpToolCall(call, "success", undefined, 215)
  const current = diagnosticForMcpServer("mcp-1", 7)
  assert.deepEqual(current?.lastCall, {
    toolName: "echo secret",
    status: "success",
    startedAt: 200,
    finishedAt: 215,
    durationMs: 15,
  })
  assert.equal(JSON.stringify(current).includes("payload"), false)

  release()
  assert.equal(diagnosticForMcpServer("mcp-1", 7)?.status, "healthy")
})

test("MCP diagnostics classify failures with stable messages and never retain raw secrets", () => {
  clearMcpDiagnostics()
  const cases = [
    [new Error("401 Authorization Bearer private-token"), "authentication"],
    [new Error("fetch failed https://api.test/mcp?token=private"), "unavailable"],
    [new Error("Invalid URL https://user:pass@test"), "configuration"],
    [new Error("initialize JSON-RPC parse secret-value"), "protocol"],
    [new Error("request timed out token=private"), "timeout"],
  ] as const
  for (const [error, kind] of cases) {
    const failure = safeMcpFailure(error, "sse")
    assert.equal(failure.kind, kind)
    assert.doesNotMatch(JSON.stringify(failure), /private|pass@test|api\.test/)
  }

  const attempt = beginMcpConnection({ serverId: "bad", transport: "stdio", configRevision: 1 }, 10)
  const failure = failMcpConnection(attempt, new Error("spawn-failed --token private"), 30)
  assert.equal(failure.code, "service-unavailable")
  assert.equal(diagnosticForMcpServer("bad", 1)?.status, "error")
  assert.doesNotMatch(JSON.stringify(getMcpDiagnostics()), /--token|private/)
})

test("MCP diagnostics ignore stale completions after a configuration revision changes", () => {
  clearMcpDiagnostics()
  const oldAttempt = beginMcpConnection(
    { serverId: "same", transport: "sse", configRevision: 1 },
    10,
  )
  const currentAttempt = beginMcpConnection(
    { serverId: "same", transport: "http", configRevision: 2 },
    20,
  )
  completeMcpConnection(currentAttempt, { toolCount: 4 }, 30)
  failMcpConnection(oldAttempt, new Error("old target failed with private-token"), 40)

  assert.equal(diagnosticForMcpServer("same", 1), undefined)
  assert.equal(diagnosticForMcpServer("same", 2)?.status, "healthy")
  assert.equal(diagnosticForMcpServer("same", 2)?.toolCount, 4)
})

test("MCP diagnostics reconcile overlapping sessions, failed probes and recovery", () => {
  clearMcpDiagnostics()
  const target = { serverId: "overlap", transport: "http" as const, configRevision: 9 }
  const runtime = beginMcpConnection(target, 10)
  const probe = beginMcpConnection(target, 11)
  const release = completeMcpConnection(runtime, { toolCount: 2, active: true }, 20)
  failMcpConnection(probe, new Error("fetch failed https://secret.test?token=x"), 30)
  assert.equal(diagnosticForMcpServer("overlap", 9)?.status, "degraded")
  assert.equal(diagnosticForMcpServer("overlap", 9)?.activeSessions, 1)

  release()
  assert.equal(diagnosticForMcpServer("overlap", 9)?.status, "error")
  const recovery = beginMcpConnection(target, 40)
  completeMcpConnection(recovery, { toolCount: 3 }, 50)
  assert.equal(diagnosticForMcpServer("overlap", 9)?.status, "healthy")
  assert.equal(diagnosticForMcpServer("overlap", 9)?.failure, null)
})

test("MCP diagnostics notify observers only with committed bounded snapshots", () => {
  clearMcpDiagnostics()
  let notifications = 0
  const dispose = subscribeMcpDiagnostics(() => {
    notifications += 1
  })
  const attempt = beginMcpConnection({ serverId: "notify", transport: "sse" }, 1)
  completeMcpConnection(attempt, { toolCount: 0 }, 2)
  assert.equal(notifications, 2)
  assert.ok(Object.isFrozen(getMcpDiagnostics()))
  dispose()
})
