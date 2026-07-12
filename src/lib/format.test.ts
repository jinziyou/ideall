import assert from "node:assert/strict"
import { test } from "node:test"
import { formatDurationSeconds } from "./format"

test("formatDurationSeconds renders media durations as mm:ss", () => {
  assert.equal(formatDurationSeconds(0), "00:00")
  assert.equal(formatDurationSeconds(65.9), "01:05")
  assert.equal(formatDurationSeconds(6_000), "100:00")
})

test("formatDurationSeconds rejects invalid media durations", () => {
  assert.equal(formatDurationSeconds(-1), "00:00")
  assert.equal(formatDurationSeconds(Number.NaN), "00:00")
  assert.equal(formatDurationSeconds(Number.POSITIVE_INFINITY), "00:00")
})
