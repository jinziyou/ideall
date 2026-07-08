import { test } from "node:test"
import assert from "node:assert/strict"
import { nodeMoveActionInput, nodeResourceRef } from "./node-actions"

test("node actions: builds node resource refs", () => {
  assert.deepEqual(nodeResourceRef("bookmark", "b1"), {
    scheme: "node",
    kind: "bookmark",
    id: "b1",
  })
})

test("node actions: builds move input without undefined afterSortKey", () => {
  assert.deepEqual(nodeMoveActionInput("folder1"), { parentId: "folder1" })
  assert.deepEqual(nodeMoveActionInput(null, "a1"), { parentId: null, afterSortKey: "a1" })
  assert.deepEqual(nodeMoveActionInput(null, null), { parentId: null, afterSortKey: null })
})
