import assert from "node:assert/strict"
import { test } from "node:test"
import type { FileRef } from "@protocol/file-system"
import { FileSystemError } from "./types"
import { paginateDirectoryItems } from "./provider-input"

const ref: FileRef = { fileSystemId: "test.files", fileId: "directory" }
const items = ["zero", "one", "two", "three"]

test("paginateDirectoryItems preserves full-page and canonical cursor behavior", () => {
  assert.deepEqual(paginateDirectoryItems(ref, items, {}), {
    items,
    offset: 0,
  })
  assert.deepEqual(paginateDirectoryItems(ref, items, { cursor: "1", limit: 2 }), {
    items: ["one", "two"],
    offset: 1,
    nextCursor: "3",
  })
  assert.deepEqual(paginateDirectoryItems(ref, items, { cursor: "4", limit: 2 }), {
    items: [],
    offset: 4,
  })
})

test("paginateDirectoryItems rejects non-canonical, negative, and unsafe cursors", () => {
  for (const cursor of ["1x", "-1", "01", "1.5", "9007199254740992"]) {
    assert.throws(
      () => paginateDirectoryItems(ref, items, { cursor }),
      (error) =>
        error instanceof FileSystemError && error.code === "invalid-input" && error.ref === ref,
      cursor,
    )
  }
})

test("paginateDirectoryItems rejects non-positive, fractional, and unsafe limits", () => {
  for (const limit of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => paginateDirectoryItems(ref, items, { limit }),
      (error) =>
        error instanceof FileSystemError && error.code === "invalid-input" && error.ref === ref,
      String(limit),
    )
  }
})
