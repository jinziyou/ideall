import { test } from "node:test"
import assert from "node:assert/strict"
import type { DirectoryEntry, FileRef } from "@protocol/file-system"
import { readAllDirectoryEntries } from "./directory-pagination"

const parent: FileRef = { fileSystemId: "test", fileId: "directory" }

function entry(entryId: string): DirectoryEntry {
  return {
    entryId,
    parent,
    target: { fileSystemId: "test", fileId: entryId },
    name: entryId,
    kind: "child",
  }
}

test("directory pagination: follows every cursor and de-duplicates entries", async () => {
  const calls: Array<{ cursor?: string; limit?: number }> = []
  const pages = new Map([
    [undefined, { entries: [entry("a"), entry("b")], nextCursor: "2" }],
    ["2", { entries: [entry("b"), entry("c")], nextCursor: "3" }],
    ["3", { entries: [entry("d")] }],
  ])

  const result = await readAllDirectoryEntries(
    async (options) => {
      calls.push(options)
      const page = pages.get(options.cursor)
      assert.ok(page)
      return page
    },
    { pageSize: 2 },
  )

  assert.deepEqual(
    result.map((item) => item.entryId),
    ["a", "b", "c", "d"],
  )
  assert.deepEqual(calls, [{ limit: 2 }, { limit: 2, cursor: "2" }, { limit: 2, cursor: "3" }])
})

test("directory pagination: rejects a repeated cursor instead of looping forever", async () => {
  let calls = 0
  await assert.rejects(
    readAllDirectoryEntries(async () => {
      calls += 1
      return { entries: [entry(String(calls))], nextCursor: "repeat" }
    }),
    /cursor loop detected/,
  )
  assert.equal(calls, 2)
})

test("directory pagination: enforces a page limit", async () => {
  let calls = 0
  await assert.rejects(
    readAllDirectoryEntries(
      async () => {
        calls += 1
        return { entries: [entry(String(calls))], nextCursor: String(calls) }
      },
      { maxPages: 2 },
    ),
    /exceeded 2 pages/,
  )
  assert.equal(calls, 2)
})
