// auth-flow XState 编排单测 —— mock ServerPort, 覆盖校验失败与 login 成功路径。
import { test, afterEach } from "node:test"
import assert from "node:assert/strict"
import { registerServerPort, type ServerPort } from "@protocol/server-port"
import { runAuthFlow } from "./auth-flow-machine"
import { runAuthHandshake } from "./auth-flow-runner"

const mockPort: ServerPort = {
  queryInfo: async () => ({ ok: false, message: "skip" }),
  getRelatedInfo: async () => [],
  getInfo: async () => ({ ok: false, message: "skip" }),
  getEntityDetail: async () => null,
  listPeers: async () => ({ ok: false, message: "skip" }),
  getPeerPublications: async () => ({ ok: false, message: "skip" }),
  publish: async () => ({ ok: false, message: "skip" }),
  deletePublication: async () => ({ ok: false, message: "skip" }),
  getServerPublicKey: async () => ({ ok: true, data: "aa".repeat(32) }),
  login: async () => ({
    ok: true,
    data: { token: "tok-test", token_type: "Bearer" },
  }),
  register: async () => ({
    ok: true,
    data: { token: "tok-reg", token_type: "Bearer" },
  }),
  getMe: async () => ({
    ok: true,
    data: { id: `u:${"1".repeat(32)}`, email: "u@test.com", name: "Test User", avatar: null },
  }),
  updateProfile: async () => ({ ok: true, data: null }),
}

afterEach(() => {
  registerServerPort(null)
})

test("runAuthHandshake: 空邮箱 → 抛错", async () => {
  registerServerPort(mockPort)
  await assert.rejects(
    () => runAuthHandshake({ mode: "login", email: "  ", password: "x" }),
    /请填写邮箱和密码/,
  )
})

test("runAuthFlow: login 成功 → token + user", async () => {
  registerServerPort(mockPort)
  const res = await runAuthFlow({
    mode: "login",
    email: "u@test.com",
    password: "secret",
  })
  assert.equal(res.token, "tok-test")
  assert.equal(res.user.name, "Test User")
})

test("runAuthFlow: 握手失败 → 可展示错误", async () => {
  registerServerPort({
    ...mockPort,
    getServerPublicKey: async () => ({ ok: false, message: "服务不可用" }),
  })
  await assert.rejects(
    () => runAuthFlow({ mode: "login", email: "u@test.com", password: "secret" }),
    /服务不可用/,
  )
})

test("runAuthFlow: V2 session 失败时不伪造数字用户 ID", async () => {
  registerServerPort({
    ...mockPort,
    getMe: async () => ({ ok: false, status: 503, message: "session unavailable" }),
  })
  await assert.rejects(
    () => runAuthFlow({ mode: "login", email: "u@test.com", password: "secret" }),
    /session unavailable/,
  )
})
