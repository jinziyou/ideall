import { test } from "node:test"
import assert from "node:assert/strict"
import type { IdeallFile } from "@protocol/file-system"
import { fileCanExpand, updateExpandedFileKeys } from "./file-tree-expansion"

const ref = { fileSystemId: "test.files", fileId: "root" }

function file(kind: IdeallFile["kind"], hasChildren?: boolean): IdeallFile {
  return {
    ref,
    kind,
    name: "fixture",
    mediaType: kind === "directory" ? "inode/directory" : "text/plain",
    capabilities: [],
    source: { kind: "system", id: "test" },
    properties: hasChildren === undefined ? {} : { hasChildren },
  }
}

test("file tree expansion: only directories with possible children expand", () => {
  assert.equal(fileCanExpand(file("directory")), true)
  assert.equal(fileCanExpand(file("directory", true)), true)
  assert.equal(fileCanExpand(file("directory", false)), false)
  assert.equal(fileCanExpand(file("file")), false)
  assert.equal(fileCanExpand(null), false)
})

test("file tree expansion: expanding and collapsing are immutable and idempotent", () => {
  const empty = new Set<string>()
  const expanded = updateExpandedFileKeys(empty, ref, true)
  assert.notEqual(expanded, empty)
  assert.deepEqual([...expanded], ["test.files:root"])
  assert.equal(updateExpandedFileKeys(expanded, ref, true), expanded)

  const collapsed = updateExpandedFileKeys(expanded, ref, false)
  assert.deepEqual([...collapsed], [])
  assert.equal(updateExpandedFileKeys(collapsed, ref, false), collapsed)
})
