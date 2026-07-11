import assert from "node:assert/strict"
import { test } from "node:test"
import type { DirectoryEntry } from "@protocol/file-system"
import { FileSystemError } from "./types"
import { iterateDirectoryPages, readAllDirectoryEntries } from "./directory-pagination"

function entry(id: string): DirectoryEntry {
  const parent = { fileSystemId: "test", fileId: "root" }
  return {
    entryId: id,
    parent,
    target: { fileSystemId: "test", fileId: id },
    name: id,
    kind: "child",
  }
}

test("directory pagination: reads multiple pages with one shared cursor contract", async () => {
  const cursors: Array<string | undefined> = []
  const entries = await readAllDirectoryEntries(
    async ({ cursor, limit }) => {
      cursors.push(cursor)
      assert.equal(limit, 2)
      if (cursor === undefined) return { entries: [entry("a"), entry("b")], nextCursor: "2" }
      return { entries: [entry("c")], nextCursor: undefined }
    },
    { pageSize: 2 },
  )

  assert.deepEqual(
    entries.map((item) => item.entryId),
    ["a", "b", "c"],
  )
  assert.deepEqual(cursors, [undefined, "2"])
})

test("directory pagination: rejects a repeated cursor", async () => {
  await assert.rejects(
    async () => {
      for await (const _entries of iterateDirectoryPages(
        async () => ({ entries: [], nextCursor: "stuck" }),
        { maxPages: 3 },
      )) {
        // consume
      }
    },
    (error) => error instanceof FileSystemError && /cursor loop detected/.test(error.message),
  )
})

test("directory pagination: rejects an unbounded stream of unique cursors", async () => {
  let page = 0
  await assert.rejects(
    async () => {
      for await (const _entries of iterateDirectoryPages(
        async () => ({ entries: [], nextCursor: String(++page) }),
        { maxPages: 3 },
      )) {
        // consume
      }
    },
    (error) => error instanceof FileSystemError && /exceeded 3 pages/.test(error.message),
  )
  assert.equal(page, 3)
})

test("directory pagination: enforces the cumulative entry limit", async () => {
  await assert.rejects(
    () =>
      readAllDirectoryEntries(
        async ({ cursor }) =>
          cursor === undefined
            ? { entries: [entry("a"), entry("b")], nextCursor: "next" }
            : { entries: [entry("c"), entry("d")] },
        { maxEntries: 3 },
      ),
    (error) => error instanceof FileSystemError && /exceeded 3 entries/.test(error.message),
  )
})
