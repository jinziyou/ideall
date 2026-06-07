// 订阅 LWW 合并纯逻辑测试 (node:test + tsx)。
import { test } from "node:test"
import assert from "node:assert/strict"

import { unionMerge, subsEqual } from "./sync"
import type { Subscription } from "@protocol/subscription"

function sub(id: string, title: string, updatedAt?: number): Subscription {
  return { id, type: "publisher", key: id, title, favicon: "", createdAt: 1000, updatedAt }
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
  const ids = unionMerge([sub("a", "A", 100)], [sub("b", "B", 100)]).map((s) => s.id).sort()
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
