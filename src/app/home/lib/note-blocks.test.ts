// note 块级并发合并回归网 (§7)。锁死核心价值与代数律:
//   - 跨块并发无损 (AI 追加 B4 / 用户改 B1 都不丢); 同块并发 LWW 一方胜 (§7.5);
//   - 墓碑不复活; 合并 交换/结合/幂等 (纯 join, GC 分离);
//   - 写补丁: delete 被 base 严格上界 (AI 追加块永不入 del); applyBlockPatch 只动点名块, v 守卫防陈旧覆盖;
//   - 存量补 id 确定性 (两端独立迁移得同 id), 空块归一化。
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  diffBlocks,
  applyBlockPatch,
  mergeNoteContent,
  pruneBlockTombstones,
  seedBlockMeta,
  blockMapById,
  deterministicBlockId,
  type Block,
  type BlockMetaMap,
} from "./note-blocks"

const blk = (id: string, text: string): Block => ({ id, type: "p", children: [{ text }] })
const m = (v: number, by: string, sk: string, del?: number) => ({ v, by, sk, ...(del ? { del } : {}) })
const ids = (bs: Block[]) => bs.map((b) => b.id)

// ── 写补丁 (diffBlocks / applyBlockPatch) ──

test("diffBlocks: AI 追加块不在 base ⇒ 永不进 delete (§7.3 核心)", () => {
  const base = blockMapById([blk("B1", "一"), blk("B2", "二")])
  const baseMeta: BlockMetaMap = { B1: m(1, "u", "a0"), B2: m(1, "u", "a1") }
  // 当前编辑器只见 B1(改)/B2; B4 是并发追加, 编辑器 base 与 current 都不含 → 不在 patch
  const patch = diffBlocks(base, baseMeta, [blk("B1", "一改"), blk("B2", "二")], "u")
  assert.deepEqual(patch.delete, [], "无删除 (B1/B2 都在)")
  assert.ok(patch.upsert.some((u) => u.id === "B1"))
  assert.equal(patch.upsert.find((u) => u.id === "B1")!.v, 2, "B1 v 自增")
})

test("diffBlocks: 用户删除 base 中的块 → 进 delete", () => {
  const base = blockMapById([blk("B1", "一"), blk("B2", "二"), blk("B3", "三")])
  const baseMeta: BlockMetaMap = { B1: m(1, "u", "a0"), B2: m(1, "u", "a1"), B3: m(1, "u", "a2") }
  const patch = diffBlocks(base, baseMeta, [blk("B1", "一"), blk("B2", "二")], "u")
  assert.deepEqual(patch.delete, ["B3"])
})

test("applyBlockPatch: 只动点名块, 并发追加的 B4 原样保留 (§7.3 反例精确解)", () => {
  // 存量 note 已被 AI 并发追加 B4; 用户的 patch 只点名 B1(改)/删 B3
  const content = [blk("B1", "一"), blk("B3", "三"), blk("B4", "AI 追加")]
  const meta: BlockMetaMap = { B1: m(1, "u", "a0"), B3: m(1, "u", "a2"), B4: m(1, "ai", "a3") }
  const patch = {
    upsert: [{ id: "B1", block: blk("B1", "一改"), v: 2, by: "u", sk: "a0" }],
    delete: ["B3"],
  }
  const out = applyBlockPatch(content, meta, patch, 1000)
  assert.ok(out.blockMeta.B4 && out.blockMeta.B4.del == null, "B4 未被点名 → 原样保留")
  assert.equal(out.blockMeta.B3.del, 1000, "B3 墓碑")
  assert.equal((out.content.find((b) => b.id === "B1")!.children as { text: string }[])[0].text, "一改")
  assert.deepEqual(ids(out.content).sort(), ["B1", "B4"], "活跃块 = B1 + B4 (B3 墓碑不渲染)")
})

test("applyBlockPatch: v 守卫 —— 陈旧 upsert (v<=现有) 跳过, 不复活 live-merge 的高版本", () => {
  const content = [blk("B1", "合并来的新版")]
  const meta: BlockMetaMap = { B1: m(5, "remote", "a0") } // live-merge 已并入 v5
  const patch = { upsert: [{ id: "B1", block: blk("B1", "陈旧 base"), v: 2, by: "u", sk: "a0" }], delete: [] }
  const out = applyBlockPatch(content, meta, patch, 1000)
  assert.equal(out.blockMeta.B1.v, 5, "陈旧 v2 upsert 被跳过, 保留 v5")
  assert.equal((out.content[0].children as { text: string }[])[0].text, "合并来的新版")
})

// ── 跨端合并 (mergeNoteContent) ──

test("跨块并发无损: 本端改 B1 / 远端追加 B4 → 两者都在", () => {
  const lc = [blk("B1", "一改"), blk("B2", "二")]
  const lm: BlockMetaMap = { B1: m(2, "u", "a0"), B2: m(1, "u", "a1") }
  const rc = [blk("B1", "一"), blk("B2", "二"), blk("B4", "远端追加")]
  const rm: BlockMetaMap = { B1: m(1, "u", "a0"), B2: m(1, "u", "a1"), B4: m(1, "r", "a2") }
  const out = mergeNoteContent(lc, lm, rc, rm)
  assert.deepEqual(ids(out.content), ["B1", "B2", "B4"])
  assert.equal((out.content[0].children as { text: string }[])[0].text, "一改", "B1 取本端 v2")
})

test("同块并发: (v,by) LWW 一方胜 (确定性 tiebreak)", () => {
  const lc = [blk("B1", "用户版")]
  const lm: BlockMetaMap = { B1: m(2, "user", "a0") }
  const rc = [blk("B1", "AI 版")]
  const rm: BlockMetaMap = { B1: m(2, "ai", "a0") } // v 并列 → by 字典序 ai < user → ai 胜
  const out = mergeNoteContent(lc, lm, rc, rm)
  assert.equal((out.content[0].children as { text: string }[])[0].text, "AI 版")
})

test("墓碑不复活: 本端删 B1(v3) / 远端 B1 活跃(v2) → 合并后 B1 仍删", () => {
  const lc: Block[] = []
  const lm: BlockMetaMap = { B1: m(3, "u", "a0", 999) }
  const rc = [blk("B1", "复活?")]
  const rm: BlockMetaMap = { B1: m(2, "r", "a0") }
  const out = mergeNoteContent(lc, lm, rc, rm)
  assert.equal(out.blockMeta.B1.del, 999, "墓碑高 v 胜")
  assert.deepEqual(ids(out.content), [], "B1 不渲染")
})

test("合并 交换律: merge(L,R) ≡ merge(R,L)", () => {
  const lc = [blk("B1", "L1"), blk("B2", "L2")]
  const lm: BlockMetaMap = { B1: m(2, "u", "a0"), B2: m(1, "u", "a1") }
  const rc = [blk("B1", "R1"), blk("B3", "R3")]
  const rm: BlockMetaMap = { B1: m(2, "z", "a0"), B3: m(1, "z", "a2") }
  const ab = mergeNoteContent(lc, lm, rc, rm)
  const ba = mergeNoteContent(rc, rm, lc, lm)
  assert.deepEqual(ab.blockMeta, ba.blockMeta)
  assert.deepEqual(ids(ab.content), ids(ba.content))
})

test("合并 幂等律: merge(X,X) ≡ X", () => {
  const c = [blk("B1", "一"), blk("B2", "二")]
  const meta: BlockMetaMap = { B1: m(1, "u", "a0"), B2: m(2, "u", "a1") }
  const out = mergeNoteContent(c, meta, c, meta)
  assert.deepEqual(out.blockMeta, meta)
  assert.deepEqual(ids(out.content), ["B1", "B2"])
})

test("合并 结合律: merge(merge(A,B),C) ≡ merge(A,merge(B,C)) (meta)", () => {
  const A: [Block[], BlockMetaMap] = [[blk("B1", "A1")], { B1: m(1, "a", "a0") }]
  const B: [Block[], BlockMetaMap] = [[blk("B1", "B1"), blk("B2", "B2")], { B1: m(2, "b", "a0"), B2: m(1, "b", "a1") }]
  const C: [Block[], BlockMetaMap] = [[blk("B3", "C3")], { B3: m(1, "c", "a2") }]
  const ab = mergeNoteContent(A[0], A[1], B[0], B[1])
  const left = mergeNoteContent(ab.content, ab.blockMeta, C[0], C[1])
  const bc = mergeNoteContent(B[0], B[1], C[0], C[1])
  const right = mergeNoteContent(A[0], A[1], bc.content, bc.blockMeta)
  assert.deepEqual(left.blockMeta, right.blockMeta)
})

// ── 墓碑 GC (单独一步) ──

test("pruneBlockTombstones: GC 过期墓碑, 保留活跃 + 未过期墓碑", () => {
  const now = 1_000_000_000_000
  const meta: BlockMetaMap = {
    live: m(1, "u", "a0"),
    fresh: m(1, "u", "a1", now - 1000),
    expired: m(1, "u", "a2", now - 100 * 24 * 3600 * 1000),
  }
  const out = pruneBlockTombstones(meta, now)
  assert.ok(out.live && out.fresh, "活跃与未过期墓碑保留")
  assert.equal(out.expired, undefined, "过期墓碑 GC")
})

// ── 存量补 id + 空块归一化 ──

test("seedBlockMeta: 确定性 id (两端独立迁移同笔记得同 id)", () => {
  const content = [blk("", "一"), blk("", "二")].map((b) => ({ ...b, id: undefined }))
  const a = seedBlockMeta("note1", content as Block[], "migrate")
  const b = seedBlockMeta("note1", content as Block[], "migrate")
  assert.deepEqual(ids(a.content), ids(b.content), "同笔记两次补 id 一致")
  assert.equal(a.content[0].id, deterministicBlockId("note1", 0, content[0] as Block))
})

test("seedBlockMeta: 空 content → 带稳定 id 的空段落 (§7.4 收敛堵漏)", () => {
  const out = seedBlockMeta("note2", [], "migrate")
  assert.equal(out.content.length, 1)
  assert.ok(typeof out.content[0].id === "string" && out.content[0].id)
  assert.ok(out.blockMeta[out.content[0].id as string])
})

test("seedBlockMeta: 已有 id 的块沿用其 id (NodeIdPlugin 已注入)", () => {
  const out = seedBlockMeta("note3", [blk("keep", "x")], "u")
  assert.equal(out.content[0].id, "keep")
})
