// syncNow 编排集成测试 (node:test + tsx)。
// syncNow 是跨端同步真实落地编排 (跨重试累积合并 / 解密 / unionMerge / GC / 脏数据过滤 / 409 冲突),
// 此前仅其纯函数零件被隔离单测、编排本身无覆盖 (M-15)。本测以内存 StorageSyncPort + stub 的
// /v1/sync/{id} 服务端 (乐观并发, {data} 包络) + 真实 sync-crypto 加解密, 端到端驱动编排各分支。
import { test, afterEach } from "node:test"
import assert from "node:assert/strict"
import { syncNow } from "./subscription-sync"
import {
  registerStorageSyncPort,
  StorageSyncConflictError,
  type StorageSyncPort,
} from "@protocol/storage-sync"
import type { Subscription } from "@protocol/subscription"
import { recordsEqual, type SyncBlob } from "@protocol/sync"
import { deriveKeys, encryptJson, decryptJson } from "@/lib/sync-crypto"
import { SYNC_MAX_ATTEMPTS } from "./sync-domain-runner"

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
    key: id.replace(/^publisher:/, ""),
    title: id,
    favicon: "",
    createdAt: ts,
    updatedAt: ts,
    ...extra,
  }
}

/** 模拟真实 feed Storage 的逻辑规范化：只保留 Subscription 契约字段。 */
function normalizeSubscription(value: Subscription): Subscription {
  const normalized: Subscription = {
    id: value.id,
    type: value.type,
    key: value.key,
    title: value.title,
    favicon: value.favicon,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  }
  if (value.entityLabel !== undefined) normalized.entityLabel = value.entityLabel
  if (value.entityName !== undefined) normalized.entityName = value.entityName
  if (value.searchKeyword !== undefined) normalized.searchKeyword = value.searchKeyword
  if (value.searchDomain !== undefined) normalized.searchDomain = value.searchDomain
  if (value.deletedAt !== undefined) normalized.deletedAt = value.deletedAt
  return normalized
}

/** 内存「服务端」: 单个同步块 + 乐观并发 (expected 不符→409); 可在首次 PUT 冲突时推进远端快照。 */
function makeServer(initial: SyncBlob | null = null) {
  const state: {
    blob: SyncBlob | null
    force409Once: boolean
    alwaysConflict: boolean
    conflictBlobOnce: SyncBlob | null
    putCount: number
    expectedValues: number[]
  } = {
    blob: initial,
    force409Once: false,
    alwaysConflict: false,
    conflictBlobOnce: null,
    putCount: 0,
    expectedValues: [],
  }
  const text = (s: number, b: string) => ({
    ok: s >= 200 && s < 300,
    status: s,
    text: async () => b,
  })
  globalThis.fetch = (async (input: string, init: RequestInit = {}) => {
    const url = String(input)
    if (!url.includes("/sync/")) throw new Error("unexpected url: " + url)
    if ((init.method ?? "GET") === "GET") {
      // v1 GET /sync/{id} 返回 {data: SyncBlob} 包络 (404 = 尚无数据)。
      return state.blob ? text(200, JSON.stringify({ data: state.blob })) : text(404, "")
    }
    // PUT: 乐观并发
    state.putCount++
    const expected = Number(url.match(/[?&]expected=(\d+)/)?.[1] ?? "0")
    state.expectedValues.push(expected)
    if (state.force409Once) {
      state.force409Once = false
      if (state.conflictBlobOnce) {
        state.blob = state.conflictBlobOnce
        state.conflictBlobOnce = null
      }
      return text(409, "conflict")
    }
    if (state.alwaysConflict) return text(409, "conflict")
    const current = state.blob?.updated_at ?? 0
    if (expected !== current) return text(409, "conflict")
    state.blob = JSON.parse(String(init.body)) as SyncBlob
    return text(200, "{}")
  }) as unknown as typeof fetch
  return state
}

/** 注册一个具备真实快照 CAS 语义的内存 StorageSyncPort。 */
function makeHub(initial: Subscription[]) {
  const store = structuredClone(initial.map(normalizeSubscription))
  const bulkCalls: { items: Subscription[]; expectedLocal: Subscription[] }[] = []
  const controls: { beforeBulk: (() => void) | null } = { beforeBulk: null }
  const port: StorageSyncPort = {
    async listAllSubscriptions() {
      return structuredClone(store)
    },
    async bulkPutSubscriptions(subs: Subscription[], expectedLocal: Subscription[]) {
      bulkCalls.push({
        items: structuredClone(subs),
        expectedLocal: structuredClone(expectedLocal),
      })
      if (controls.beforeBulk) {
        const beforeBulk = controls.beforeBulk
        controls.beforeBulk = null
        beforeBulk()
      }
      const desired = subs.map(normalizeSubscription)
      if (recordsEqual(store, desired)) return structuredClone(store)
      if (!recordsEqual(store, expectedLocal)) {
        throw new StorageSyncConflictError("关注")
      }
      store.length = 0
      store.push(...structuredClone(desired))
      return structuredClone(store)
    },
    async listAllNotes() {
      throw new Error("subscription test hub does not implement notes")
    },
    async bulkPutNotes() {
      throw new Error("subscription test hub does not implement notes")
    },
  }
  registerStorageSyncPort(port)
  return { store, bulkCalls, controls }
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

test("syncNow: 持续 409 恰好尝试上限次数后失败", async () => {
  const server = makeServer()
  server.alwaysConflict = true
  makeHub([sub("publisher:a", 1000)])

  await assert.rejects(() => syncNow(CODE), /同步冲突/)
  assert.equal(server.putCount, SYNC_MAX_ATTEMPTS)
})

test("syncNow: 本地 CAS 冲突保留并发写且不会发起 PUT", async () => {
  const { key } = await deriveKeys(CODE)
  const encrypted = await encryptJson(key, [sub("publisher:remote", 2000)])
  const server = makeServer({ iv: encrypted.iv, ciphertext: encrypted.ciphertext, updated_at: 10 })
  const hub = makeHub([sub("publisher:local", 1000)])
  hub.controls.beforeBulk = () => {
    hub.store.push(sub("publisher:concurrent", 3000))
  }

  await assert.rejects(() => syncNow(CODE), /关注在同步期间发生了本地变化/)
  assert.equal(server.putCount, 0)
  assert.deepEqual(hub.store.map((item) => item.id).sort(), [
    "publisher:concurrent",
    "publisher:local",
  ])
})

test("syncNow: 409 后远端推进 → 用首次提交快照作为下一轮本地 CAS 基线", async () => {
  const { key } = await deriveKeys(CODE)
  const remoteWithLegacyField = {
    ...sub("publisher:b", 2000),
    legacy: "storage must strip me",
  } as Subscription
  const firstRemote = [remoteWithLegacyField]
  const advancedRemote = [remoteWithLegacyField, sub("publisher:c", 3000)]
  const firstEncrypted = await encryptJson(key, firstRemote)
  const advancedEncrypted = await encryptJson(key, advancedRemote)
  const server = makeServer({
    iv: firstEncrypted.iv,
    ciphertext: firstEncrypted.ciphertext,
    updated_at: 10,
  })
  server.force409Once = true
  server.conflictBlobOnce = {
    iv: advancedEncrypted.iv,
    ciphertext: advancedEncrypted.ciphertext,
    updated_at: 20,
  }
  const hub = makeHub([sub("publisher:a", 1000)])

  const res = await syncNow(CODE)

  assert.equal(server.putCount, 2, "首次 409 后应只重试一次")
  assert.deepEqual(server.expectedValues, [10, 20], "重试必须基于最新远端版本")
  assert.equal(hub.bulkCalls.length, 2, "每轮新合并结果都应提交到本地")
  assert.deepEqual(hub.bulkCalls[0].expectedLocal.map((s) => s.id).sort(), ["publisher:a"])
  assert.deepEqual(hub.bulkCalls[0].items.map((s) => s.id).sort(), ["publisher:a", "publisher:b"])
  assert.deepEqual(
    hub.bulkCalls[1].expectedLocal.map((s) => s.id).sort(),
    ["publisher:a", "publisher:b"],
    "第二轮 CAS 基线应是第一轮 bulk 返回的已提交快照",
  )
  assert.equal(
    hub.bulkCalls[0].items.some((item) => item.id === "publisher:b" && "legacy" in item),
    true,
    "首轮请求仍含远端扩展字段",
  )
  assert.equal(
    hub.bulkCalls[1].expectedLocal.some((item) => "legacy" in item),
    false,
    "第二轮 CAS 必须使用 Storage 返回的规范化快照",
  )
  assert.deepEqual(hub.bulkCalls[1].items.map((s) => s.id).sort(), [
    "publisher:a",
    "publisher:b",
    "publisher:c",
  ])
  assert.deepEqual(hub.store.map((s) => s.id).sort(), ["publisher:a", "publisher:b", "publisher:c"])
  const decoded = await decryptJson<Subscription[]>(key, server.blob!.iv, server.blob!.ciphertext)
  assert.deepEqual(decoded.map((s) => s.id).sort(), ["publisher:a", "publisher:b", "publisher:c"])
  assert.equal(
    decoded.some((item) => "legacy" in item),
    false,
  )
  assert.deepEqual(res, { total: 3, added: 2 })
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

test("syncNow: 清洗非规范身份、未知类型、空白 key 与不安全工具 URL", async () => {
  const { key } = await deriveKeys(CODE)
  const invalid = [
    { ...sub("publisher:forged", 2000), key: "actual" },
    { ...sub("publisher:unknown", 2000), type: "unknown" },
    { ...sub("publisher:space", 2000), key: " space" },
    {
      id: "tool:javascript:alert(1)",
      type: "tool",
      key: "javascript:alert(1)",
      title: "unsafe",
      favicon: "",
      createdAt: 2000,
      updatedAt: 2000,
    },
  ]
  const encrypted = await encryptJson(key, [sub("publisher:good", 2000), ...invalid])
  const server = makeServer({ iv: encrypted.iv, ciphertext: encrypted.ciphertext, updated_at: 1 })
  const hub = makeHub([])

  await syncNow(CODE)

  assert.deepEqual(
    hub.store.map((item) => item.id),
    ["publisher:good"],
  )
  const decoded = await decryptJson<Subscription[]>(key, server.blob!.iv, server.blob!.ciphertext)
  assert.deepEqual(
    decoded.map((item) => item.id),
    ["publisher:good"],
  )
})

// ── 无变更跳过上传 (远端是单一加密 blob, 等价时不重新加密/PUT —— 周期同步只下载) ──

test("syncNow: 合并结果与远端等价 → 跳过重新加密上传", async () => {
  const { key } = await deriveKeys(CODE)
  const subs = [sub("publisher:a", 1000)]
  const enc = await encryptJson(key, subs)
  const server = makeServer({ iv: enc.iv, ciphertext: enc.ciphertext, updated_at: 111 })
  makeHub(subs)
  const res = await syncNow(CODE)
  assert.equal(server.putCount, 0, "无变更 → 不应 PUT")
  assert.equal(server.blob!.updated_at, 111, "远端 blob 保持原样")
  assert.equal(res.total, 1)
})

test("syncNow: 远端含非法项 → 即使有效集等价也重传清洗", async () => {
  const { key } = await deriveKeys(CODE)
  const subs = [sub("publisher:a", 1000)]
  const enc = await encryptJson(key, [...subs, { type: "publisher", key: "x", title: "脏" }])
  const server = makeServer({ iv: enc.iv, ciphertext: enc.ciphertext, updated_at: 1 })
  makeHub(subs)
  await syncNow(CODE)
  assert.equal(server.putCount, 1, "含脏项 → 重传以清洗远端")
  const decoded = await decryptJson<Subscription[]>(key, server.blob!.iv, server.blob!.ciphertext)
  assert.deepEqual(
    decoded.map((s) => s.id),
    ["publisher:a"],
  )
})
