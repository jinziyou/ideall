// syncNow 编排集成测试 (node:test + tsx)。
// syncNow 是跨端同步真实落地编排 (跨重试累积合并 / 解密 / unionMerge / GC / 脏数据过滤 / 409 冲突),
// 此前仅其纯函数零件被隔离单测、编排本身无覆盖 (M-15)。本测以内存 FilesPort + stub 的
// /sync/{id} 服务端 (乐观并发) + 真实 sync-crypto 加解密, 端到端驱动编排各分支。
import { test, afterEach } from "node:test"
import assert from "node:assert/strict"
import { syncNow } from "./subscription-sync"
import { registerFilesPort, type FilesPort } from "@protocol/files"
import type { Subscription } from "@protocol/subscription"
import type { SyncBlob } from "@protocol/sync"
import { deriveKeys, encryptJson, decryptJson } from "@/lib/sync-crypto"

const CODE = "0123456789abcdef0123456789abcdef" // 32 hex = 合法同步码

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

/** 构造一条最小合法关注 (createdAt=updatedAt=ts)。 */
function sub(id: string, ts: number, extra: Partial<Subscription> = {}): Subscription {
  return {
    id,
    type: "publisher",
    key: id,
    title: id,
    favicon: "",
    createdAt: ts,
    updatedAt: ts,
    ...extra,
  }
}

/** 内存「服务端」: 单个同步块 + 乐观并发 (expected 不符→409); 可强制首次 PUT 409 测重试。 */
function makeServer(initial: SyncBlob | null = null) {
  const state = { blob: initial, force409Once: false }
  const text = (s: number, b: string) => ({
    ok: s >= 200 && s < 300,
    status: s,
    text: async () => b,
  })
  globalThis.fetch = (async (input: string, init: RequestInit = {}) => {
    const url = String(input)
    if (!url.includes("/sync/")) throw new Error("unexpected url: " + url)
    if ((init.method ?? "GET") === "GET") {
      return state.blob ? text(200, JSON.stringify(state.blob)) : text(404, "")
    }
    // PUT: 乐观并发
    if (state.force409Once) {
      state.force409Once = false
      return text(409, "conflict")
    }
    const expected = Number(url.match(/[?&]expected=(\d+)/)?.[1] ?? "0")
    const current = state.blob?.updated_at ?? 0
    if (expected !== current) return text(409, "conflict")
    state.blob = JSON.parse(String(init.body)) as SyncBlob
    return text(200, "{}")
  }) as unknown as typeof fetch
  return state
}

/** 注册一个内存 FilesPort, 返回其 store (syncNow 仅用 listAllSubscriptions / bulkPutSubscriptions)。 */
function makeHub(initial: Subscription[]) {
  const store: Subscription[] = initial.map((s) => ({ ...s }))
  const port = {
    async listAllSubscriptions() {
      return store.map((s) => ({ ...s }))
    },
    async bulkPutSubscriptions(subs: Subscription[]) {
      store.length = 0
      store.push(...subs.map((s) => ({ ...s })))
    },
  }
  registerFilesPort(port as unknown as FilesPort)
  return { store }
}

test("syncNow: 同步码非法 → 抛错", async () => {
  makeServer()
  makeHub([])
  await assert.rejects(() => syncNow("bad"), /同步码格式不正确/)
})

test("syncNow: 空服务端 → 上传本地, 统计正确", async () => {
  const server = makeServer()
  makeHub([sub("publisher:a", 1000)])
  const res = await syncNow(CODE)
  assert.equal(res.total, 1)
  assert.equal(res.added, 0) // 本地已有, 非新增
  assert.ok(server.blob, "服务端应已写入密文")
})

test("syncNow: 跨端并集合并 (LWW) —— 拉到对端关注并落地本地", async () => {
  const server = makeServer()
  const { key } = await deriveKeys(CODE)
  // 设备 A 先上传 [a]
  makeHub([sub("publisher:a", 1000)])
  await syncNow(CODE)
  // 设备 B 本地有 [b], 同步后应得到 [a, b]
  const b = makeHub([sub("publisher:b", 1000)])
  const res = await syncNow(CODE)
  assert.deepEqual(b.store.map((s) => s.id).sort(), ["publisher:a", "publisher:b"])
  assert.equal(res.total, 2)
  assert.equal(res.added, 1) // a 是本地原本没有的新活跃
  const decoded = await decryptJson<Subscription[]>(key, server.blob!.iv, server.blob!.ciphertext)
  assert.equal(decoded.length, 2)
})

test("syncNow: 墓碑删除跨端传播 (较新墓碑 LWW 胜过本地活跃)", async () => {
  const now = Date.now()
  const { key } = await deriveKeys(CODE)
  // 服务端预置 a 的墓碑 (deletedAt=now, 较新), 本地 a 仍活跃但较旧
  const enc = await encryptJson(key, [sub("publisher:a", now, { deletedAt: now })])
  makeServer({ iv: enc.iv, ciphertext: enc.ciphertext, updated_at: now - 5000 })
  const b = makeHub([sub("publisher:a", now - 10000)])
  const res = await syncNow(CODE)
  assert.equal(res.total, 0) // 活跃口径下 a 已被墓碑收敛
  const a = b.store.find((s) => s.id === "publisher:a")
  assert.equal(a?.deletedAt, now, "本地 a 应被墓碑覆盖 (未过 90 天 TTL, 非物理删)")
})

test("syncNow: 409 冲突 → 有界重试后成功", async () => {
  const server = makeServer()
  server.force409Once = true
  makeHub([sub("publisher:a", 1000)])
  const res = await syncNow(CODE)
  assert.equal(res.total, 1)
  assert.ok(server.blob, "重试后应写入成功")
})

test("syncNow: 过滤远端非法项 (缺 id 不污染 unionMerge)", async () => {
  const { key } = await deriveKeys(CODE)
  // good 合法 + bad 缺 id (会让 unionMerge 以 undefined 作 Map 键)
  const bad = { type: "publisher", key: "x", title: "x" }
  const enc = await encryptJson(key, [sub("publisher:good", 2000), bad])
  makeServer({ iv: enc.iv, ciphertext: enc.ciphertext, updated_at: 1 })
  const b = makeHub([])
  const res = await syncNow(CODE)
  assert.equal(res.total, 1)
  assert.deepEqual(
    b.store.map((s) => s.id),
    ["publisher:good"],
  )
})
