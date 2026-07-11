import assert from "node:assert/strict"
import { test } from "node:test"
import { nextUpdatedAt } from "./version"

test("nextUpdatedAt: 时钟未前进时仍严格递增", () => {
  assert.equal(nextUpdatedAt(100, 100), 101)
  assert.equal(nextUpdatedAt(101, 100), 102)
})

test("nextUpdatedAt: 时钟已前进时使用当前时间", () => {
  assert.equal(nextUpdatedAt(100, 200), 200)
})
