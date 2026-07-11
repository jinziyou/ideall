import { test } from "node:test"
import assert from "node:assert/strict"
import type { TrashFileItem, TrashFileSystemDeps } from "./trash-file-system"
import { createTrashFileSystem, trashItemRef, trashRootRef } from "./trash-file-system"
import { FileSystemError } from "./types"

const ITEM: TrashFileItem = {
  id: "note-1",
  kind: "note",
  title: "Deleted note",
  deletedAt: 20,
  updatedAt: 20,
  parentId: null,
  tags: ["draft"],
  restorable: true,
  snapshot: true,
  detail: "可恢复正文快照",
}

function fixture() {
  let listener: Parameters<TrashFileSystemDeps["onUpdated"]>[0] | null = null
  const calls: string[] = []
  const fs = createTrashFileSystem({
    async empty() {
      calls.push("empty")
      return 1
    },
    async list() {
      return [ITEM]
    },
    async purge(id) {
      calls.push(`purge:${id}`)
    },
    async restore(kind, id) {
      calls.push(`restore:${kind}:${id}`)
    },
    onUpdated(next) {
      listener = next
      return () => {
        listener = null
      }
    },
  })
  return { fs, calls, notify: () => listener?.({ kind: "note", id: ITEM.id }) }
}

test("trash filesystem: projects tombstones and owns restore/purge/empty actions", async () => {
  const { fs, calls } = fixture()
  const directory = await fs.readDirectory(trashRootRef, {
    actor: "ui",
    permissions: [],
    intent: "directory",
  })
  assert.equal(directory.entries[0]?.entryId, trashItemRef(ITEM.id).fileId)
  assert.equal(directory.entries[0]?.properties?.detail, ITEM.detail)

  const actionCtx = { actor: "ui", permissions: [], intent: "action" } as const
  await fs.invoke(trashItemRef(ITEM.id), "restore", undefined, actionCtx)
  await fs.invoke(trashItemRef(ITEM.id), "purge", undefined, actionCtx)
  assert.deepEqual(await fs.invoke(trashRootRef, "empty", undefined, actionCtx), { count: 1 })
  assert.deepEqual(calls, ["restore:note:note-1", "purge:note-1", "empty"])
})

test("trash filesystem: stat returns null for a missing item while reads stay strict", async () => {
  const { fs } = fixture()
  const missing = trashItemRef("missing")

  assert.equal(await fs.stat(missing, { actor: "ui", permissions: [], intent: "metadata" }), null)
  await assert.rejects(
    fs.read(missing, { actor: "ui", permissions: [], intent: "content" }),
    (error) => error instanceof FileSystemError && error.code === "not-found",
  )
  await assert.rejects(
    fs.actions(missing, { actor: "ui", permissions: [], intent: "action" }),
    (error) => error instanceof FileSystemError && error.code === "not-found",
  )
})

test("trash filesystem: enforces permissions and forwards storage watch events", async () => {
  const { fs, notify } = fixture()
  await assert.rejects(
    fs.readDirectory(trashRootRef, {
      actor: "agent",
      permissions: [],
      intent: "directory",
    }),
    (error) => error instanceof FileSystemError && error.code === "permission-denied",
  )

  let events = 0
  const handle = fs.watch?.(
    trashItemRef(ITEM.id),
    { actor: "agent", permissions: ["fs:read"], intent: "watch" },
    () => events++,
  )
  assert.ok(handle)
  notify()
  assert.equal(events, 1)
  handle.dispose()
})
