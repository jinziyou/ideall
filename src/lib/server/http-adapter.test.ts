// HTTP 适配器运行时语义门测试 (node:test + tsx)。
// 编译期漂移门 (wire DTO → 领域类型可赋值) 由 `pnpm typecheck` 覆盖, 不在此重复;
// 此处守「结构对、含义错」的单位漂移 (epoch 毫秒 vs 秒, 见 info-timestamp-unit-ms 约定)。
import { test } from "node:test"
import assert from "node:assert/strict"

import { looksLikeMillis } from "./http-adapter"

test("looksLikeMillis: 合法 epoch 毫秒 (近年) 为 true", () => {
  assert.equal(looksLikeMillis(1_700_000_000_000), true) // 2023, ms
  assert.equal(looksLikeMillis(Date.parse("2026-06-18T00:00:00Z")), true)
})

test("looksLikeMillis: 0 为「无时间」哨兵, true", () => {
  assert.equal(looksLikeMillis(0), true)
})

test("looksLikeMillis: 秒级时间戳被识破 (false) —— 防 ms→s 单位漂移", () => {
  assert.equal(looksLikeMillis(1_700_000_000), false) // 2023, 秒
  assert.equal(looksLikeMillis(1_750_000_000), false)
})

test("looksLikeMillis: 非有限值 false", () => {
  assert.equal(looksLikeMillis(Number.NaN), false)
  assert.equal(looksLikeMillis(Number.POSITIVE_INFINITY), false)
  assert.equal(looksLikeMillis(-1), false)
})
