// 订阅 LWW 合并纯逻辑测试 (node:test + tsx)。
import { test } from "node:test"
import assert from "node:assert/strict"

import {
  unionMerge,
  subsEqual,
  isLive,
  isTombstone,
  isExpiredTombstone,
  pruneExpiredTombstones,
  expiredTombstoneIdsToDelete,
  TOMBSTONE_TTL_MS,
} from "./sync"
import type { Subscription } from "@protocol/subscription"

function sub(id: string, title: string, updatedAt?: number): Subscription {
  return { id, type: "publisher", key: id, title, favicon: "", createdAt: 1000, updatedAt }
}

/** 墓碑: 已删除项 (deletedAt 设, updatedAt 同步为删除时间, 与 store 写法一致)。 */
function tomb(id: string, deletedAt: number): Subscription {
  return {
    id,
    type: "publisher",
    key: id,
    title: id,
    favicon: "",
    createdAt: 1000,
    updatedAt: deletedAt,
    deletedAt,
  }
}

test("unionMerge: 远端较新 → 远端字段胜 (修复旧版无条件丢弃远端更新)", () => {
  const m = unionMerge([sub("a", "本地A", 100)], [sub("a", "远端A", 200)])
  assert.equal(m.length, 1)
  assert.equal(m[0].title, "远端A")
})

test("unionMerge: 本地较新 → 本地胜", () => {
  const m = unionMerge([sub("a", "本地A", 300)], [sub("a", "远端A", 200)])
  assert.equal(m[0].title, "本地A")
})

test("unionMerge: updatedAt 并列 → 本地优先 (稳定)", () => {
  assert.equal(unionMerge([sub("a", "本地A", 200)], [sub("a", "远端A", 200)])[0].title, "本地A")
})

test("unionMerge: 并集保留各自独有 id", () => {
  const ids = unionMerge([sub("a", "A", 100)], [sub("b", "B", 100)])
    .map((s) => s.id)
    .sort()
  assert.deepEqual(ids, ["a", "b"])
})

test("unionMerge: updatedAt 缺省回退 createdAt", () => {
  // 本地无 updatedAt (createdAt=1000) vs 远端 updatedAt=500 → 本地 1000 胜
  const local: Subscription[] = [
    { id: "a", type: "publisher", key: "a", title: "本地", favicon: "", createdAt: 1000 },
  ]
  assert.equal(unionMerge(local, [sub("a", "远端", 500)])[0].title, "本地")
})

test("subsEqual: 顺序无关相等 / 字段变 / 长度变", () => {
  const a = [sub("1", "X", 1), sub("2", "Y", 1)]
  assert.equal(subsEqual(a, [sub("2", "Y", 1), sub("1", "X", 1)]), true)
  assert.equal(subsEqual(a, [sub("1", "X2", 1), sub("2", "Y", 1)]), false)
  assert.equal(subsEqual(a, [sub("1", "X", 1)]), false)
})

// ── 墓碑 (tombstone) 删除传播 / 复活 (Low-6) ────────────────────────────────────────

test("unionMerge: 删除较新 → 墓碑胜 (删除跨端收敛, 不被对端活跃副本复活)", () => {
  // 本端删除 a@200 (墓碑) vs 远端仍持活跃 a@100 → 墓碑胜。
  const m = unionMerge([tomb("a", 200)], [sub("a", "远端A", 100)])
  assert.equal(m.length, 1)
  assert.equal(isTombstone(m[0]), true)
  assert.equal(isLive(m[0]), false)
})

test("unionMerge: 删后重订阅较新 → 活跃项胜 (复活)", () => {
  // 远端墓碑 a@200 vs 本端删后又重新订阅 a@300 (活跃) → 活跃胜, 无 deletedAt。
  const m = unionMerge([sub("a", "重订阅A", 300)], [tomb("a", 200)])
  assert.equal(m[0].title, "重订阅A")
  assert.equal(m[0].deletedAt, undefined)
  assert.equal(isLive(m[0]), true)
})

test("unionMerge: 远端墓碑较新 → 本端活跃项被删除收敛", () => {
  // 另一端删除 a@300 (墓碑) 拉到本端, 本端活跃 a@100 → 墓碑胜 → 本端读路径将过滤掉。
  const m = unionMerge([sub("a", "本地A", 100)], [tomb("a", 300)])
  assert.equal(isTombstone(m[0]), true)
})

test("isExpiredTombstone: 过保留期 true / 未过 false / 非墓碑 false", () => {
  const now = 1_000_000_000_000
  assert.equal(isExpiredTombstone(tomb("a", now - TOMBSTONE_TTL_MS - 1), now), true)
  assert.equal(isExpiredTombstone(tomb("a", now - 1000), now), false)
  assert.equal(isExpiredTombstone(sub("a", "活跃", now), now), false)
})

test("pruneExpiredTombstones: GC 过期墓碑, 保留活跃 + 未过期墓碑", () => {
  const now = 1_000_000_000_000
  const items = [
    sub("live", "活跃", now),
    tomb("recent", now - 1000), // 未过期墓碑 → 留 (尚需传播给其它端)
    tomb("old", now - TOMBSTONE_TTL_MS - 1), // 过期墓碑 → GC
  ]
  const ids = pruneExpiredTombstones(items, now)
    .map((s) => s.id)
    .sort()
  assert.deepEqual(ids, ["live", "recent"])
})

test("expiredTombstoneIdsToDelete: 只删过期墓碑, 不误删并发新增/复活/新墓碑 (落地侧数据安全)", () => {
  const now = 1_000_000_000_000
  // 模拟落地时刻库的真实状态 (含同步快照之后的并发写)。
  const existing = [
    tomb("expired", now - TOMBSTONE_TTL_MS - 1), // 过期墓碑、且不在本批 → 应删
    tomb("recent", now - 1000), // 未过期墓碑 → 不删 (尚需传播)
    sub("concurrentAdd", "窗口内新订阅", now), // 并发新增活跃订阅, 不在本批 kept → 绝不能删
    tomb("revived-as-tomb", now - TOMBSTONE_TTL_MS - 1), // 过期墓碑但本批正写回复活活跃版 → keepIds 含之 → 不删
  ]
  const keepIds = new Set(["recent", "revived-as-tomb"]) // 本批写入集合 (kept)
  const ids = expiredTombstoneIdsToDelete(existing, keepIds, now)
  assert.deepEqual(ids, ["expired"]) // 仅过期且不在本批的墓碑
})
