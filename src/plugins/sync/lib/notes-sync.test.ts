// 笔记跨端块级合并回归 (§7 ②): notes-sync 的 note 级合并 —— 整篇删除 node 级 LWW, 正文块级合并。
// 锁死: 跨端并发改不同块无损; 较新整篇删除胜; 较旧墓碑被较新活跃复活。
// 末尾另有 syncNotes 编排测试: 无变更跳过上传 / 有本地新增照常上传 (内存服务端 + 真实加解密)。
import { test, afterEach } from "node:test"
import assert from "node:assert/strict"
import type { Note } from "@protocol/files"
import {
  registerStorageSyncPort,
  StorageSyncConflictError,
  type StorageSyncPort,
} from "@protocol/storage-sync"
import { recordsEqual, type SyncBlob } from "@protocol/sync"
import { decryptJson, deriveKeys, encryptJson } from "@/lib/sync-crypto"
import { mergeTwoNotes, mergeNotes, isValidRemoteNote, syncNotes } from "./notes-sync"

const blk = (id: string, text: string) => ({ id, type: "p", children: [{ text }] })
const note = (over: Partial<Note>): Note => ({
  id: "n1",
  title: "笔记",
  content: [],
  parentId: null,
  sortKey: "a0",
  tags: [],
  createdAt: 1,
  updatedAt: 1,
  ...over,
})

test("跨端并发改不同块: 本端改 B1 / 远端加 B2 → 两块都在 (块级无损)", () => {
  const a = note({
    content: [blk("B1", "本端改")],
    blockMeta: { B1: { v: 2, by: "A", sk: "a0" } },
    updatedAt: 10,
  })
  const b = note({
    content: [blk("B1", "原"), blk("B2", "远端加")],
    blockMeta: { B1: { v: 1, by: "B", sk: "a0" }, B2: { v: 1, by: "B", sk: "a1" } },
    updatedAt: 11,
  })
  const out = mergeTwoNotes(a, b)
  assert.deepEqual(
    out.content.map((x) => (x as { id: string }).id),
    ["B1", "B2"],
    "B1(本端改) + B2(远端加) 都保留",
  )
  assert.equal(
    (out.content[0] as { children: { text: string }[] }).children[0].text,
    "本端改",
    "B1 取高版本 (v2)",
  )
  assert.equal(out.deletedAt, undefined)
})

test("较新整篇删除胜 (node 级 LWW): 远端删 (updatedAt 大) → 合并为墓碑", () => {
  const a = note({
    content: [blk("B1", "x")],
    blockMeta: { B1: { v: 1, by: "A", sk: "a0" } },
    updatedAt: 10,
  })
  const b = note({ content: [], deletedAt: 20, updatedAt: 20 })
  const out = mergeTwoNotes(a, b)
  assert.equal(out.deletedAt, 20, "整篇删除胜")
})

test("较旧墓碑被较新活跃复活: 本端墓碑(旧) / 远端活跃(新) → 合并为活跃内容", () => {
  const a = note({ content: [], deletedAt: 5, updatedAt: 5 })
  const b = note({
    content: [blk("B1", "复活内容")],
    blockMeta: { B1: { v: 2, by: "B", sk: "a0" } },
    updatedAt: 20,
  })
  const out = mergeTwoNotes(a, b)
  assert.equal(out.deletedAt, undefined, "较新活跃复活")
  assert.equal((out.content[0] as { children: { text: string }[] }).children[0].text, "复活内容")
})

test("无 blockMeta 的笔记 (旧记录/老端) → 整篇 LWW 兜底, 绝不丢正文", () => {
  // 两边都无 blockMeta: 块级合并会因空 meta 重建出空正文 → 必须走整篇 LWW。
  const a = note({ content: [blk("B1", "本端正文")], updatedAt: 10 }) // 无 blockMeta
  const b = note({ content: [blk("B1", "远端正文")], updatedAt: 20 }) // 无 blockMeta
  const out = mergeTwoNotes(a, b)
  assert.equal(out.content.length, 1, "正文不丢")
  assert.equal(
    (out.content[0] as { children: { text: string }[] }).children[0].text,
    "远端正文",
    "较新整篇胜",
  )
  // 一边有 meta 一边无 → 仍整篇 LWW (不进块级合并)
  const c = note({
    content: [blk("B1", "有meta")],
    blockMeta: { B1: { v: 1, by: "C", sk: "a0" } },
    updatedAt: 30,
  })
  const out2 = mergeTwoNotes(a, c)
  assert.equal(out2.content.length, 1, "混合也不丢正文")
})

test("isValidRemoteNote: 拒投毒 content (null 元素) / 脏 blockMeta; 收合法 + 缺 blockMeta", () => {
  const ok = note({ content: [blk("B1", "x")], blockMeta: { B1: { v: 1, by: "A", sk: "a0" } } })
  assert.equal(isValidRemoteNote(ok), true, "合法笔记")
  assert.equal(
    isValidRemoteNote(note({ content: [blk("B1", "x")] })),
    true,
    "缺 blockMeta 也合法 (旧端)",
  )
  // content 含 null 元素 → 拒 (否则 blockMapById 取 null.id 崩溃, 瘫痪全端同步)
  assert.equal(
    isValidRemoteNote({ ...ok, content: [null, blk("B1", "x")] }),
    false,
    "拒 null content 元素",
  )
  // blockMeta 类型错 (v 非 number) → 拒 (否则 pickMeta NaN 比较破坏可交换性 → 合并不收敛)
  assert.equal(
    isValidRemoteNote({ ...ok, blockMeta: { B1: { v: "bad", by: "A", sk: "a0" } } }),
    false,
    "拒脏 blockMeta",
  )
  // del 非 number → 拒 (否则逃过墓碑 GC)
  assert.equal(
    isValidRemoteNote({ ...ok, blockMeta: { B1: { v: 1, by: "A", sk: "a0", del: "x" } } }),
    false,
    "拒脏 del",
  )
})

test("isValidRemoteNote: 拒远未来时间戳 (防永久钉死 LWW / 不死墓碑)", () => {
  const now = 1_000_000_000_000
  const far = now + 10 * 24 * 60 * 60 * 1000 // now + 10 天, 超 1 天容差
  const ok = note({ createdAt: now - 2000, updatedAt: now - 1000 })
  assert.equal(isValidRemoteNote(ok, now), true, "现实时间戳合法")
  assert.equal(isValidRemoteNote({ ...ok, updatedAt: far }, now), false, "拒远未来 updatedAt")
  assert.equal(
    isValidRemoteNote({ ...ok, deletedAt: far }, now),
    false,
    "拒远未来 deletedAt(不死墓碑)",
  )
  assert.equal(
    isValidRemoteNote({ ...ok, blockMeta: { B1: { v: 1, by: "A", sk: "a0", del: far } } }, now),
    false,
    "拒远未来块墓碑 del",
  )
})

test("mergeNotes: 单边笔记直取, 同 id 合并, 交换律 (集合等价)", () => {
  const a = [
    note({ id: "n1", content: [blk("B1", "A")], blockMeta: { B1: { v: 1, by: "A", sk: "a0" } } }),
  ]
  const b = [
    note({
      id: "n1",
      content: [blk("B1", "A"), blk("B2", "B")],
      blockMeta: { B1: { v: 1, by: "A", sk: "a0" }, B2: { v: 1, by: "B", sk: "a1" } },
    }),
    note({ id: "n2", title: "另一篇" }),
  ]
  const ab = mergeNotes(a, b)
  assert.equal(ab.length, 2, "n1 合并 + n2 单边")
  const n1 = ab.find((n) => n.id === "n1")!
  assert.deepEqual(
    n1.content.map((x) => (x as { id: string }).id),
    ["B1", "B2"],
  )
})

// ── syncNotes 编排: 无变更跳过上传 (远端是单一加密 blob, 等价时不重新加密/PUT) ──

const CODE = "0123456789abcdef0123456789abcdef" // 32 hex = 合法同步码

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

/** 内存「服务端」(同 subscription-sync.test): 单同步块 + 乐观并发; putCount 计收到的 PUT 数。 */
function makeServer(initial: SyncBlob | null = null) {
  const state = { blob: initial, putCount: 0 }
  const text = (s: number, b: string) => ({
    ok: s >= 200 && s < 300,
    status: s,
    text: async () => b,
  })
  globalThis.fetch = (async (input: string, init: RequestInit = {}) => {
    const url = String(input)
    if (!url.includes("/sync/")) throw new Error("unexpected url: " + url)
    if ((init.method ?? "GET") === "GET") {
      return state.blob ? text(200, JSON.stringify({ data: state.blob })) : text(404, "")
    }
    state.putCount++
    const expected = Number(url.match(/[?&]expected=(\d+)/)?.[1] ?? "0")
    const current = state.blob?.updated_at ?? 0
    if (expected !== current) return text(409, "conflict")
    state.blob = JSON.parse(String(init.body)) as SyncBlob
    return text(200, "{}")
  }) as unknown as typeof fetch
  return state
}

/** 内存 StorageSyncPort (syncNotes 仅用笔记同步原始面)，实现真实快照 CAS。 */
function makeNotesHub(initial: Note[]) {
  const normalizeNote = (value: Note): Note => {
    const { kind: _kind, ...logical } = value as Note & { kind?: unknown }
    return structuredClone(logical)
  }
  const store = structuredClone(initial.map(normalizeNote))
  const bulkCalls: { items: Note[]; expectedLocal: Note[] }[] = []
  const port: StorageSyncPort = {
    async listAllSubscriptions() {
      throw new Error("notes test hub does not implement subscriptions")
    },
    async bulkPutSubscriptions() {
      throw new Error("notes test hub does not implement subscriptions")
    },
    async listAllNotes() {
      return structuredClone(store)
    },
    async bulkPutNotes(ns: Note[], expectedLocal: Note[]) {
      bulkCalls.push({ items: structuredClone(ns), expectedLocal: structuredClone(expectedLocal) })
      const desired = ns.map(normalizeNote)
      if (recordsEqual(store, desired)) return structuredClone(store)
      if (!recordsEqual(store, expectedLocal)) {
        throw new StorageSyncConflictError("笔记")
      }
      store.length = 0
      store.push(...structuredClone(desired))
      return structuredClone(store)
    },
  }
  registerStorageSyncPort(port)
  return { store, bulkCalls }
}

test("syncNotes: 合并结果与远端等价 → 跳过重新加密上传", async () => {
  const { key } = await deriveKeys(CODE, "notes")
  const notes = [note({ id: "n1", createdAt: 1000, updatedAt: 1000 })]
  const enc = await encryptJson(key, notes)
  const server = makeServer({ iv: enc.iv, ciphertext: enc.ciphertext, updated_at: 111 })
  makeNotesHub(notes)
  const res = await syncNotes(CODE)
  assert.equal(server.putCount, 0, "无变更 → 不应 PUT")
  assert.equal(server.blob!.updated_at, 111, "远端 blob 保持原样")
  assert.equal(res.total, 1)
})

test("syncNotes: 本地有远端没有的笔记 → 照常上传", async () => {
  const server = makeServer()
  makeNotesHub([note({ id: "n1", createdAt: 1000, updatedAt: 1000 })])
  const res = await syncNotes(CODE)
  assert.equal(server.putCount, 1, "有增量 → 应 PUT 一次")
  assert.ok(server.blob, "服务端应已写入密文")
  assert.equal(res.total, 1)
})

test("syncNotes: 拉取远端增量时以初始快照执行本地 CAS", async () => {
  const { key } = await deriveKeys(CODE, "notes")
  const remoteNotes = [
    {
      ...note({ id: "remote", createdAt: 2000, updatedAt: 2000 }),
      kind: "note",
    } as Note,
  ]
  const encrypted = await encryptJson(key, remoteNotes)
  const server = makeServer({ iv: encrypted.iv, ciphertext: encrypted.ciphertext, updated_at: 123 })
  const hub = makeNotesHub([note({ id: "local", createdAt: 1000, updatedAt: 1000 })])

  const res = await syncNotes(CODE)

  assert.equal(hub.bulkCalls.length, 1)
  assert.deepEqual(
    hub.bulkCalls[0].expectedLocal.map((n) => n.id),
    ["local"],
  )
  assert.deepEqual(hub.bulkCalls[0].items.map((n) => n.id).sort(), ["local", "remote"])
  assert.deepEqual(hub.store.map((n) => n.id).sort(), ["local", "remote"])
  assert.equal(
    hub.store.some((item) => "kind" in item),
    false,
  )
  const decoded = await decryptJson<Note[]>(key, server.blob!.iv, server.blob!.ciphertext)
  assert.equal(
    decoded.some((item) => "kind" in item),
    false,
  )
  assert.deepEqual(res, { total: 2, added: 1 })
})
