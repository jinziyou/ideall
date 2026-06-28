// apiFetch 错误分支单测 (node:test + tsx)。
// apiFetch 是全项目取数唯一统一封装, 四条错误分支 (网络 / 读响应体 / !ok / JSON 解析) 是所有
// ServerPort 方法的公共依赖、回归面广。经 resolveFetch 在非 Tauri 环境回退全局 fetch,
// 故 stub globalThis.fetch 即可端到端驱动各分支。
import { test, afterEach } from "node:test"
import assert from "node:assert/strict"
import { apiFetch } from "./api"

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

type FakeResp = { ok: boolean; status: number; text: () => Promise<string> }

function setFetch(handler: (input: string, init: RequestInit) => FakeResp): void {
  globalThis.fetch = (async (input: string, init: RequestInit = {}) =>
    handler(input, init)) as unknown as typeof fetch
}

function resp(status: number, body: string): FakeResp {
  return { ok: status >= 200 && status < 300, status, text: async () => body }
}

test("apiFetch: 网络错误 (fetch 抛) → ok:false + 网络错误消息", async () => {
  setFetch(() => {
    throw new Error("ECONNREFUSED")
  })
  const r = await apiFetch("/x")
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.message, /网络错误/)
})

test("apiFetch: 读响应体失败 → ok:false + 默认错误消息 + 透传 status", async () => {
  setFetch(() => ({
    ok: true,
    status: 200,
    text: async () => {
      throw new Error("stream aborted")
    },
  }))
  const r = await apiFetch("/x", { defaultErrorMessage: "自定义失败" })
  assert.equal(r.ok, false)
  if (!r.ok) {
    assert.equal(r.status, 200)
    assert.equal(r.message, "自定义失败")
  }
})

test("apiFetch: !ok 且体含 detail → 提取 detail 作错误消息", async () => {
  setFetch(() => resp(400, JSON.stringify({ detail: "参数非法" })))
  const r = await apiFetch("/x")
  assert.equal(r.ok, false)
  if (!r.ok) {
    assert.equal(r.status, 400)
    assert.equal(r.message, "参数非法")
  }
})

test("apiFetch: !ok 且体为纯文本 → 用文本作错误消息", async () => {
  setFetch(() => resp(500, "boom"))
  const r = await apiFetch("/x")
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.message, "boom")
})

test("apiFetch: ok 但响应非 JSON → ok:false + 解析错误消息", async () => {
  setFetch(() => resp(200, "not json {"))
  const r = await apiFetch("/x")
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.message, /响应格式错误/)
})

test("apiFetch: 成功 JSON → ok:true + data", async () => {
  setFetch(() => resp(200, JSON.stringify({ a: 1 })))
  const r = await apiFetch<{ a: number }>("/x")
  assert.equal(r.ok, true)
  if (r.ok) assert.deepEqual(r.data, { a: 1 })
})

test("apiFetch: 空响应体 (204) → ok:true + data:null", async () => {
  setFetch(() => resp(204, ""))
  const r = await apiFetch("/x")
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.data, null)
})

test("apiFetch: json 选项 → 设 Content-Type 并序列化 body", async () => {
  let seen: RequestInit = {}
  setFetch((_input, init) => {
    seen = init
    return resp(200, JSON.stringify({ ok: true }))
  })
  await apiFetch("/x", { method: "POST", json: { hello: "世界" } })
  assert.equal(seen.method, "POST")
  assert.equal((seen.headers as Record<string, string>)["Content-Type"], "application/json")
  assert.equal(seen.body, JSON.stringify({ hello: "世界" }))
})
