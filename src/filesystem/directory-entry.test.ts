import { test } from "node:test"
import assert from "node:assert/strict"
import type { DirectoryEntry } from "@protocol/file-system"
import {
  directoryEntryIconHint,
  directoryEntryPreferredEngine,
  directoryEntryTargetKindHint,
} from "./directory-entry"

const entry: DirectoryEntry = {
  entryId: "bookmarks",
  pathName: "bookmarks",
  name: "书签",
  parent: { fileSystemId: "navigation", fileId: "/home" },
  target: { fileSystemId: "core", fileId: "panel:bookmarks" },
  kind: "link",
  properties: {
    preferredEngine: "ideall.panel",
    iconHint: "bookmark",
    targetKind: "file",
  },
}

test("directory entry hints: 集中读取受限的 Display hint", () => {
  assert.equal(directoryEntryPreferredEngine(entry), "ideall.panel")
  assert.equal(directoryEntryIconHint(entry), "bookmark")
  assert.equal(directoryEntryTargetKindHint(entry), "file")
  assert.equal(
    directoryEntryPreferredEngine({ ...entry, properties: { preferredEngine: " bad " } }),
    undefined,
  )
})
