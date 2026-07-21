// 关注 LWW 合并纯逻辑测试 (node:test + tsx)。
import { test } from "node:test"
import assert from "node:assert/strict"

import {
  unionMerge,
  recordsEqual,
  isLive,
  isTombstone,
  isExpiredTombstone,
  pruneExpiredTombstones,
  expiredTombstoneIdsToDelete,
  isSaneSyncTimestamp,
  MAX_FUTURE_SKEW_MS,
  TOMBSTONE_TTL_MS,
  getSyncTelemetrySnapshot,
  recordSyncTelemetry,
  subscribeSyncTelemetry,
} from "./sync"
import type { Subscription } from "./subscription"

function sub(id: string, title: string, updatedAt: number): Subscription {
  return { id, type: "publisher", key: id, title, favicon: "", createdAt: 1000, updatedAt }
}

/** 删除标记: 已删除项 (deletedAt 设, updatedAt 同步为删除时间, 与 store 写法一致)。 */
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

test("recordsEqual: 顺序无关相等 / 字段变 / 长度变", () => {
  const a = [sub("1", "X", 1), sub("2", "Y", 1)]
  assert.equal(recordsEqual(a, [sub("2", "Y", 1), sub("1", "X", 1)]), true)
  assert.equal(recordsEqual(a, [sub("1", "X2", 1), sub("2", "Y", 1)]), false)
  assert.equal(recordsEqual(a, [sub("1", "X", 1)]), false)
})

test("recordsEqual: 对象字段插入顺序不影响结构等价，数组顺序仍参与比较", () => {
  const left = [
    {
      id: "nested",
      createdAt: 1,
      updatedAt: 2,
      payload: { z: 1, a: { second: true, first: false } },
      items: ["a", "b"],
    },
  ]
  const reordered = [
    {
      items: ["a", "b"],
      payload: { a: { first: false, second: true }, z: 1 },
      updatedAt: 2,
      createdAt: 1,
      id: "nested",
    },
  ]
  assert.equal(recordsEqual(left, reordered), true)
  assert.equal(recordsEqual(left, [{ ...reordered[0], items: ["b", "a"] }]), false)
})

test("sync telemetry: 只发布最近一次非敏感结果并通知订阅者", () => {
  let notifications = 0
  const dispose = subscribeSyncTelemetry(() => {
    notifications += 1
  })
  recordSyncTelemetry({
    status: "failure",
    startedAt: 10,
    finishedAt: 30,
    durationMs: 20,
    total: null,
    added: null,
    failureCode: "network",
  })
  dispose()

  assert.equal(notifications, 1)
  assert.deepEqual(getSyncTelemetrySnapshot(), {
    status: "failure",
    startedAt: 10,
    finishedAt: 30,
    durationMs: 20,
    total: null,
    added: null,
    failureCode: "network",
  })
})

// ── 删除标记 (tombstone) 删除传播 / 恢复 (Low-6) ────────────────────────────────────────

test("unionMerge: 删除较新 → 删除标记胜 (删除跨端收敛, 不被对端活跃副本恢复)", () => {
  // 本端删除 a@200 (删除标记) vs 远端仍持活跃 a@100 → 删除标记胜。
  const m = unionMerge([tomb("a", 200)], [sub("a", "远端A", 100)])
  assert.equal(m.length, 1)
  assert.equal(isTombstone(m[0]), true)
  assert.equal(isLive(m[0]), false)
})

test("unionMerge: 删后重关注较新 → 活跃项胜 (恢复)", () => {
  // 远端删除标记 a@200 vs 本端删后又重新关注 a@300 (活跃) → 活跃胜, 无 deletedAt。
  const m = unionMerge([sub("a", "重关注A", 300)], [tomb("a", 200)])
  assert.equal(m[0].title, "重关注A")
  assert.equal(m[0].deletedAt, undefined)
  assert.equal(isLive(m[0]), true)
})

test("unionMerge: 远端删除标记较新 → 本端活跃项被删除收敛", () => {
  // 另一端删除 a@300 (删除标记) 拉到本端, 本端活跃 a@100 → 删除标记胜 → 本端读路径将过滤掉。
  const m = unionMerge([sub("a", "本地A", 100)], [tomb("a", 300)])
  assert.equal(isTombstone(m[0]), true)
})

test("isSaneSyncTimestamp: 过去/现在/容差内为真; 远未来/负数/非数字为假 (防远未来时间戳钉死 LWW)", () => {
  const now = 1_000_000_000_000
  assert.equal(isSaneSyncTimestamp(now - 999, now), true)
  assert.equal(isSaneSyncTimestamp(now, now), true)
  assert.equal(isSaneSyncTimestamp(now + MAX_FUTURE_SKEW_MS, now), true) // 容差边界内
  assert.equal(isSaneSyncTimestamp(now + MAX_FUTURE_SKEW_MS + 1, now), false) // 超容差未来 → 拒
  assert.equal(isSaneSyncTimestamp(253402300800000, now), false) // 公元 9999 类远未来 → 拒
  assert.equal(isSaneSyncTimestamp(-1, now), false)
  assert.equal(isSaneSyncTimestamp(NaN, now), false)
  assert.equal(isSaneSyncTimestamp(Infinity, now), false)
  assert.equal(isSaneSyncTimestamp("123", now), false)
  assert.equal(isSaneSyncTimestamp(undefined, now), false)
})

test("isExpiredTombstone: 过保留期 true / 未过 false / 非删除标记 false", () => {
  const now = 1_000_000_000_000
  assert.equal(isExpiredTombstone(tomb("a", now - TOMBSTONE_TTL_MS - 1), now), true)
  assert.equal(isExpiredTombstone(tomb("a", now - 1000), now), false)
  assert.equal(isExpiredTombstone(sub("a", "活跃", now), now), false)
})

test("pruneExpiredTombstones: GC 过期删除标记, 保留活跃 + 未过期删除标记", () => {
  const now = 1_000_000_000_000
  const items = [
    sub("live", "活跃", now),
    tomb("recent", now - 1000), // 未过期删除标记 → 留 (尚需传播给其它端)
    tomb("old", now - TOMBSTONE_TTL_MS - 1), // 过期删除标记 → GC
  ]
  const ids = pruneExpiredTombstones(items, now)
    .map((s) => s.id)
    .sort()
  assert.deepEqual(ids, ["live", "recent"])
})

test("expiredTombstoneIdsToDelete: 只删过期删除标记, 不误删并发新增/恢复/新删除标记 (落地侧数据安全)", () => {
  const now = 1_000_000_000_000
  // 模拟落地时刻库的真实状态 (含同步快照之后的并发写)。
  const existing = [
    tomb("expired", now - TOMBSTONE_TTL_MS - 1), // 过期删除标记、且不在本批 → 应删
    tomb("recent", now - 1000), // 未过期删除标记 → 不删 (尚需传播)
    sub("concurrentAdd", "窗口内新关注", now), // 并发新增活跃关注, 不在本批 kept → 绝不能删
    tomb("revived-as-tomb", now - TOMBSTONE_TTL_MS - 1), // 过期删除标记但本批正写回恢复活跃版 → keepIds 含之 → 不删
  ]
  const keepIds = new Set(["recent", "revived-as-tomb"]) // 本批写入集合 (kept)
  const ids = expiredTombstoneIdsToDelete(existing, keepIds, now)
  assert.deepEqual(ids, ["expired"]) // 仅过期且不在本批的删除标记
})
