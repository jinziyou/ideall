// 单元: OAuth provider 的回调解析 + token/verifier 持久化 (端到端授权需真实 server + 浏览器, 不自动化)。
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  parseAuthCallback,
  mcpOAuthProvider,
  isMcpAuthorized,
  clearMcpAuth,
  hydrateMcpOAuthSecure,
  revokeMcpAuth,
} from "./agent-oauth"
import { secureFallbackStorageKey } from "@/lib/secure-store"

// node 无 localStorage → 内存 polyfill。agent-oauth 顶层不读 localStorage (load 在函数内), 故 import 后再装即可。
const mem = new Map<string, string>()
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size
  },
} as Storage

test("parseAuthCallback: 回调 URL 与裸 code", () => {
  assert.deepEqual(parseAuthCallback("http://127.0.0.1:7843/callback?code=abc&state=s1"), {
    code: "abc",
    state: "s1",
  })
  assert.deepEqual(parseAuthCallback("  rawcode  "), { code: "rawcode" })
})

test("provider 持久化: tokens / verifier roundtrip + isMcpAuthorized + clear", async () => {
  const p = mcpOAuthProvider("srv1")
  assert.equal(isMcpAuthorized("srv1"), false)

  await p.saveTokens({ access_token: "tok", token_type: "Bearer" })
  assert.equal(isMcpAuthorized("srv1"), true)
  assert.equal((await p.tokens())?.access_token, "tok")

  await p.saveCodeVerifier("ver-123")
  assert.equal(await p.codeVerifier(), "ver-123")

  // 跨实例共享 (都读同一 localStorage)
  assert.equal((await mcpOAuthProvider("srv1").tokens())?.access_token, "tok")

  clearMcpAuth("srv1")
  assert.equal(isMcpAuthorized("srv1"), false)
})

test("revokeMcpAuth: 服务端撤销失败 (不可达) 仍清本机 token", async () => {
  const p = mcpOAuthProvider("srv-rev")
  await p.saveTokens({ access_token: "tok", token_type: "Bearer" })
  p.saveClientInformation?.({ client_id: "cid" })
  assert.equal(isMcpAuthorized("srv-rev"), true)
  // serverUrl 不可达 → discover/撤销失败 → finally 仍 clearMcpAuth
  await revokeMcpAuth("srv-rev", "http://127.0.0.1:1/")
  assert.equal(isMcpAuthorized("srv-rev"), false)
})

test("hydrateMcpOAuthSecure: 迁移旧 localStorage token/verifier 并清理公开状态", async () => {
  mem.clear()
  mem.set(
    "ideall:agent:oauth:legacy",
    JSON.stringify({
      clientInfo: { client_id: "cid" },
      tokens: { access_token: "legacy-token", token_type: "Bearer" },
      codeVerifier: "legacy-verifier",
      state: "s1",
    }),
  )

  await hydrateMcpOAuthSecure("legacy")
  assert.equal(isMcpAuthorized("legacy"), true)
  assert.equal((await mcpOAuthProvider("legacy").tokens())?.access_token, "legacy-token")
  assert.equal(await mcpOAuthProvider("legacy").codeVerifier(), "legacy-verifier")

  const publicState = mem.get("ideall:agent:oauth:legacy") ?? ""
  assert.ok(!publicState.includes("legacy-token"))
  assert.ok(!publicState.includes("legacy-verifier"))
  assert.ok(
    mem.get(secureFallbackStorageKey("ideall:agent:oauth:legacy:tokens"))?.includes("legacy-token"),
  )
})
