// L3 Grant 纯逻辑测试 (node:test + tsx)。createLocalMcpServer 的 transport/MCP 绑定不在此单测,
// 此处守显式授权模型本身: 一方 Grant 构造、过期判定 (失效→能力层起零工具, 见 createLocalMcpServer)。
import { test } from "node:test"
import assert from "node:assert/strict"

import { firstPartyGrant, isGrantActive, agentGrant, type Grant } from "./grant"
import type { Manifest } from "./manifest"
import { infoEmbedManifest, communityEmbedManifest } from "./manifest"

const NOW = 1_700_000_000_000

function manifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    id: "info",
    name: "资讯",
    version: "1.0.0",
    entry: "https://web.wonita.link/info",
    origins: ["https://web.wonita.link"],
    minHostProtocol: "1.0",
    permissions: ["hub.subscriptions:read", "hub.subscriptions:write"],
    ...overrides,
  }
}

test("firstPartyGrant: T0 —— 采信 manifest 权限, 自动/不过期/不可撤, origin 取 entry", () => {
  const g = firstPartyGrant(manifest(), NOW)
  assert.equal(g.tier, "first-party")
  assert.equal(g.consumerId, "info")
  assert.equal(g.origin, "https://web.wonita.link")
  assert.deepEqual(g.permissions, ["hub.subscriptions:read", "hub.subscriptions:write"])
  assert.equal(g.grantedAt, NOW)
  assert.equal(g.expiry, null)
  assert.equal(g.revocable, false)
})

test("firstPartyGrant: entry 非法 URL → origin 回退到 origins[0]", () => {
  const g = firstPartyGrant(manifest({ entry: "not-a-url" }), NOW)
  assert.equal(g.origin, "https://web.wonita.link")
})

test("isGrantActive: expiry=null 恒有效", () => {
  assert.equal(isGrantActive(firstPartyGrant(manifest(), NOW), NOW + 1e12), true)
})

test("isGrantActive: 未过期 true / 已过期 false (失效时能力层挂零工具)", () => {
  const g: Grant = { ...firstPartyGrant(manifest(), NOW), expiry: NOW + 1000 }
  assert.equal(isGrantActive(g, NOW + 500), true)
  assert.equal(isGrantActive(g, NOW + 1500), false)
})

// ── §6.2 隐私不变量: agentGrant 与 iframe manifest 的授权集 (锁死 §9 清单) ──

test("agentGrant: 含 fs:read/fs:write/fs.notes:write/ui.tabs", () => {
  const g = agentGrant(NOW)
  assert.equal(g.tier, "first-party")
  assert.equal(g.consumerId, "ideall-agent")
  assert.equal(g.expiry, null)
  for (const p of ["fs:read", "fs:write", "fs.notes:write", "ui.tabs"] as const) {
    assert.ok(g.permissions.includes(p), `agentGrant 应含 ${p}`)
  }
})

test("agentGrant **不含** fs.notes:read (既存笔记正文须 @ 引用 consent, 不默认外发)", () => {
  assert.equal(agentGrant(NOW).permissions.includes("fs.notes:read"), false)
})

test("iframe embed manifest (info/community) 永不含 fs.notes:read / fs.notes:write", () => {
  for (const m of [infoEmbedManifest, communityEmbedManifest]) {
    assert.equal(m.permissions.includes("fs.notes:read"), false, `${m.id} 不得含 fs.notes:read`)
    assert.equal(m.permissions.includes("fs.notes:write"), false, `${m.id} 不得含 fs.notes:write`)
  }
})
