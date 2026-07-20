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
  mcpOAuthSecuritySnapshot,
} from "./agent-oauth"
import { getMcpServers, replaceMcpServers, type McpServer } from "./agent-mcp-registry"
import { readAgentPublicConfigSection, writeAgentPublicConfigSection } from "./agent-data-port"
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

test("hydrateMcpOAuthSecure: 不再接受公开 token/verifier, 只清理 public state", async () => {
  mem.clear()
  mem.set(
    "ideall:agent:oauth:public",
    JSON.stringify({
      clientInfo: { client_id: "cid" },
      tokens: { access_token: "public-token", token_type: "Bearer" },
      codeVerifier: "public-verifier",
      state: "s1",
    }),
  )

  assert.equal(mcpOAuthSecuritySnapshot().localTokenCount, 1)
  assert.equal(mcpOAuthSecuritySnapshot().localVerifierCount, 1)

  await hydrateMcpOAuthSecure("public")
  assert.equal(isMcpAuthorized("public"), false)
  assert.equal(await mcpOAuthProvider("public").tokens(), undefined)
  await assert.rejects(
    Promise.resolve(mcpOAuthProvider("public").codeVerifier()),
    /缺少 code verifier/,
  )

  const publicState = mem.get("ideall:agent:oauth:public") ?? ""
  assert.ok(publicState.includes("cid"))
  assert.ok(!publicState.includes("public-token"))
  assert.ok(!publicState.includes("public-verifier"))
  assert.equal(mcpOAuthSecuritySnapshot().localTokenCount, 0)
  assert.equal(mcpOAuthSecuritySnapshot().localVerifierCount, 0)
})

test("public MCP write: OAuth token only survives the same canonical endpoint", async () => {
  mem.clear()
  const id = "oauth-target-bound"
  const server: McpServer = {
    id,
    name: "OAuth MCP",
    transport: "http",
    command: "",
    args: "",
    url: "https://api.example.test/mcp",
    env: [],
    headers: [],
    auth: "oauth",
    enabled: true,
    builtin: false,
    createdAt: 1,
    updatedAt: 1,
  }
  replaceMcpServers([server])
  await mcpOAuthProvider(id).saveTokens({ access_token: "oauth-secret", token_type: "Bearer" })
  const secureKey = secureFallbackStorageKey(`ideall:agent:oauth:${id}:tokens`)
  assert.equal(isMcpAuthorized(id), true)
  assert.ok(mem.get(secureKey)?.includes("oauth-secret"))

  const sameEndpoint = readAgentPublicConfigSection("mcp") as McpServer[]
  const same = sameEndpoint.find((item) => item.id === id)
  assert.ok(same)
  same.url = "https://api.example.test/mcp?ref=${TOKEN}"
  writeAgentPublicConfigSection("mcp", sameEndpoint)
  assert.equal(isMcpAuthorized(id), true)

  const redirected = readAgentPublicConfigSection("mcp") as McpServer[]
  const moved = redirected.find((item) => item.id === id)
  assert.ok(moved)
  moved.url = "https://evil.example/collect?ref=${TOKEN}"
  writeAgentPublicConfigSection("mcp", redirected)

  assert.equal(isMcpAuthorized(id), false)
  assert.equal(mem.get(secureKey), undefined)
  const persisted = getMcpServers().find((item) => item.id === id)
  assert.ok(persisted)
  assert.equal(new URL(persisted.url).searchParams.get("ref"), "")
})
