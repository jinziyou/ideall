// 单元: OAuth provider 的回调解析 + token/verifier 持久化 (端到端授权需真实 server + 浏览器, 不自动化)。
import { test } from "node:test"
import assert from "node:assert/strict"
import { parseAuthCallback, mcpOAuthProvider, isMcpAuthorized, clearMcpAuth } from "./agent-oauth"

// node 无 localStorage → 内存 polyfill。agent-oauth 顶层不读 localStorage (load 在函数内), 故 import 后再装即可。
const mem = new Map<string, string>()
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
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

  p.saveTokens({ access_token: "tok", token_type: "Bearer" })
  assert.equal(isMcpAuthorized("srv1"), true)
  assert.equal((await p.tokens())?.access_token, "tok")

  p.saveCodeVerifier("ver-123")
  assert.equal(await p.codeVerifier(), "ver-123")

  // 跨实例共享 (都读同一 localStorage)
  assert.equal((await mcpOAuthProvider("srv1").tokens())?.access_token, "tok")

  clearMcpAuth("srv1")
  assert.equal(isMcpAuthorized("srv1"), false)
})
