// 笔记跨端块级合并回归 (§7 ②): notes-sync 的 note 级合并 —— 整篇删除 node 级 LWW, 正文块级合并。
// 锁死: 跨端并发改不同块无损; 较新整篇删除胜; 较旧墓碑被较新活跃复活。
import { test } from "node:test"
import assert from "node:assert/strict"
import type { Note } from "@protocol/files"
import { mergeTwoNotes, mergeNotes, isValidRemoteNote } from "./notes-sync"

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
