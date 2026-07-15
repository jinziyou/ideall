import assert from "node:assert/strict"
import { test } from "node:test"
import { threadMetadataFromIndexSnapshot } from "./thread-metadata-store"

test("thread metadata store: preserves index order and filters deleted or malformed keys", () => {
  const liveKey: IDBValidKey = ["thread", "live", "Live title", 20, "b0", 10]
  const duplicateKey: IDBValidKey = ["thread", "duplicate", "Duplicate title", 30, "c0", 11]
  const metadata = threadMetadataFromIndexSnapshot(
    [
      { key: liveKey, primaryKey: "live" },
      { key: ["thread", "deleted", "Deleted", 40, "d0", 12], primaryKey: "deleted" },
      { key: duplicateKey, primaryKey: "duplicate" },
      { key: ["note", "wrong-kind", "Note", 1, "a0", 1], primaryKey: "wrong-kind" },
      { key: ["thread", "wrong-primary", "Wrong", 1, "a0", 1], primaryKey: "other" },
      { key: ["thread", "short"], primaryKey: "short" },
    ],
    ["deleted"],
  )

  assert.deepEqual(
    metadata.map((node) => ({
      id: node.id,
      title: node.title,
      updatedAt: node.updatedAt,
      sortKey: node.sortKey,
      createdAt: node.createdAt,
      messages: node.content.messages,
    })),
    [
      {
        id: "live",
        title: "Live title",
        updatedAt: 20,
        sortKey: "b0",
        createdAt: 10,
        messages: [],
      },
      {
        id: "duplicate",
        title: "Duplicate title",
        updatedAt: 30,
        sortKey: "c0",
        createdAt: 11,
        messages: [],
      },
    ],
  )
})
