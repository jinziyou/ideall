// L3 Grant 纯逻辑测试 (node:test + tsx)。createHubMcpServer 的 transport/MCP 绑定不在此单测,
// 此处守显式授权模型本身: 一方 Grant 构造、过期判定 (失效→能力层起零工具, 见 createHubMcpServer)。
import { test } from "node:test"
import assert from "node:assert/strict"

import { firstPartyGrant, isGrantActive, type Grant } from "./grant"
import type { Manifest } from "./manifest"

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
