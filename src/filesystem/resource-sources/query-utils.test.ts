import assert from "node:assert/strict"
import { test } from "node:test"
import type { ResourceMeta } from "@protocol/resource"
import { matchesResourceText, paginateResourceMeta } from "./query-utils"

function meta(id: string, title: string): ResourceMeta {
  return {
    ref: { scheme: "node", kind: "note", id },
    title,
    capabilities: [],
  }
}

test("resource query text matching trims input and ignores case", () => {
  const item = meta("one", "Project Notes")
  assert.equal(matchesResourceText(item, undefined), true)
  assert.equal(matchesResourceText(item, "  "), true)
  assert.equal(matchesResourceText(item, " notes "), true)
  assert.equal(matchesResourceText(item, "missing"), false)
})

test("resource query pagination preserves order and returns the next offset", () => {
  const items = [meta("one", "One"), meta("two", "Two"), meta("three", "Three")]
  assert.deepEqual(paginateResourceMeta(items, 1, "1"), {
    items: [items[1]],
    nextCursor: "2",
  })
  assert.deepEqual(paginateResourceMeta(items, 2, "invalid"), {
    items: items.slice(0, 2),
    nextCursor: "2",
  })
})
