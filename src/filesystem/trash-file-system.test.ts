import { test } from "node:test"
import assert from "node:assert/strict"
import type { TrashFileItem, TrashFileSystemDeps } from "./trash-file-system"
import {
  createTrashFileSystem,
  TRASH_ROOT_MEDIA_TYPE,
  trashCollectionVersion,
  trashItemRef,
  trashRootRef,
} from "./trash-file-system"
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

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function fixture(outcomes: { restore?: boolean; purge?: boolean; empty?: number | null } = {}) {
  let listener: Parameters<TrashFileSystemDeps["onUpdated"]>[0] | null = null
  const calls: string[] = []
  const mutations: Array<{
    action: "restore" | "purge"
    expected: Parameters<TrashFileSystemDeps["purge"]>[1]
  }> = []
  const emptyExpectations: Array<Parameters<TrashFileSystemDeps["empty"]>[0]> = []
  const fs = createTrashFileSystem({
    async empty(expected) {
      calls.push("empty")
      emptyExpectations.push(expected)
      return Object.hasOwn(outcomes, "empty") ? (outcomes.empty ?? null) : 1
    },
    async list() {
      return [ITEM]
    },
    async purge(id, expected) {
      calls.push(`purge:${id}`)
      mutations.push({ action: "purge", expected })
      return outcomes.purge ?? true
    },
    async restore(kind, id, expected) {
      calls.push(`restore:${kind}:${id}`)
      mutations.push({ action: "restore", expected })
      return outcomes.restore ?? true
    },
    onUpdated(next) {
      listener = next
      return () => {
        listener = null
      }
    },
  })
  return {
    fs,
    calls,
    mutations,
    emptyExpectations,
    notify: () => listener?.({ kind: "note", id: ITEM.id }),
  }
}

test("trash filesystem: projects tombstones and owns restore/purge/empty actions", async () => {
  const { fs, calls, mutations } = fixture()
  const root = await fs.stat(trashRootRef, {
    actor: "ui",
    permissions: [],
    intent: "metadata",
  })
  assert.equal(root?.kind, "directory")
  assert.equal(root?.mediaType, TRASH_ROOT_MEDIA_TYPE)
  assert.equal(root?.properties?.trashRoot, true)
  const rootRead = await fs.read(trashRootRef, {
    actor: "ui",
    permissions: [],
    intent: "content",
  })
  assert.equal(rootRead.mediaType, TRASH_ROOT_MEDIA_TYPE)
  assert.equal(rootRead.version, await trashCollectionVersion([ITEM]))
  assert.match(rootRead.version ?? "", /^trash-v2:[0-9a-f]{64}$/)
  const directory = await fs.readDirectory(trashRootRef, {
    actor: "ui",
    permissions: [],
    intent: "directory",
  })
  assert.equal(directory.entries[0]?.entryId, trashItemRef(ITEM.id).fileId)
  assert.equal(directory.entries[0]?.properties?.detail, ITEM.detail)

  const actionCtx = { actor: "ui", permissions: [], intent: "action" } as const
  assert.deepEqual(await fs.invoke(trashItemRef(ITEM.id), "restore", undefined, actionCtx), {
    ref: trashItemRef(ITEM.id),
    restored: true,
  })
  assert.deepEqual(await fs.invoke(trashItemRef(ITEM.id), "purge", undefined, actionCtx), {
    ref: trashItemRef(ITEM.id),
    deleted: true,
  })
  assert.deepEqual(await fs.invoke(trashRootRef, "empty", undefined, actionCtx), { count: 1 })
  assert.deepEqual(calls, ["restore:note:note-1", "purge:note-1", "empty"])
  assert.deepEqual(mutations, [
    {
      action: "restore",
      expected: { kind: ITEM.kind, updatedAt: ITEM.updatedAt, deletedAt: ITEM.deletedAt },
    },
    {
      action: "purge",
      expected: { kind: ITEM.kind, updatedAt: ITEM.updatedAt, deletedAt: ITEM.deletedAt },
    },
  ])
})

test("trash filesystem: stale restore/purge outcomes map to conflict", async () => {
  const { fs, calls } = fixture({ restore: false, purge: false })
  const ref = trashItemRef(ITEM.id)
  const actionCtx = { actor: "ui", permissions: [], intent: "action" } as const

  await assert.rejects(
    fs.invoke(ref, "restore", undefined, actionCtx),
    (error) => error instanceof FileSystemError && error.code === "conflict",
  )
  await assert.rejects(
    fs.invoke(ref, "purge", undefined, actionCtx),
    (error) => error instanceof FileSystemError && error.code === "conflict",
  )
  assert.deepEqual(calls, ["restore:note:note-1", "purge:note-1"])
})

test("trash filesystem: action expectedVersion is checked against the fresh item", async () => {
  const { fs, calls } = fixture()
  const ref = trashItemRef(ITEM.id)
  const actionCtx = { actor: "ui", permissions: [], intent: "action" } as const

  await assert.rejects(
    fs.invoke(ref, "restore", undefined, actionCtx, { expectedVersion: "19" }),
    (error) => error instanceof FileSystemError && error.code === "conflict",
  )
  await assert.rejects(
    fs.invoke(ref, "purge", undefined, actionCtx, { expectedVersion: null }),
    (error) => error instanceof FileSystemError && error.code === "conflict",
  )
  assert.deepEqual(calls, [])

  assert.deepEqual(
    await fs.invoke(ref, "restore", undefined, actionCtx, {
      expectedVersion: String(ITEM.updatedAt),
    }),
    { ref, restored: true },
  )
  assert.deepEqual(calls, ["restore:note:note-1"])
})

test("trash filesystem: empty binds confirmation to the exact collection snapshot", async () => {
  const { fs, calls, emptyExpectations } = fixture()
  const actionCtx = { actor: "ui", permissions: [], intent: "action" } as const
  const expectedVersion = await trashCollectionVersion([ITEM])

  await assert.rejects(
    fs.invoke(trashRootRef, "empty", undefined, actionCtx, { expectedVersion: "stale" }),
    (error) => error instanceof FileSystemError && error.code === "conflict",
  )
  assert.deepEqual(calls, [])

  assert.deepEqual(
    await fs.invoke(trashRootRef, "empty", undefined, actionCtx, { expectedVersion }),
    { count: 1 },
  )
  assert.deepEqual(emptyExpectations, [
    [{ id: ITEM.id, kind: ITEM.kind, updatedAt: ITEM.updatedAt, deletedAt: ITEM.deletedAt }],
  ])

  const raced = fixture({ empty: null })
  await assert.rejects(
    raced.fs.invoke(trashRootRef, "empty", undefined, actionCtx, { expectedVersion }),
    (error) => error instanceof FileSystemError && error.code === "conflict",
  )
})

test("trash filesystem: collection version is order-independent SHA-256 over exact semantics", async () => {
  const second = {
    id: "file\u0000two",
    kind: "file" as const,
    updatedAt: 30,
    deletedAt: 31,
  }
  const first = await trashCollectionVersion([ITEM, second])

  assert.match(first, /^trash-v2:[0-9a-f]{64}$/)
  assert.equal(await trashCollectionVersion([second, ITEM]), first)
  assert.notEqual(
    await trashCollectionVersion([ITEM, { ...second, deletedAt: second.deletedAt + 1 }]),
    first,
  )
})

test("trash filesystem: root read freezes count and version before async hashing", async () => {
  const source = [{ ...ITEM }]
  const hashing = deferred()
  const releaseHash = deferred()
  let captured: readonly Pick<TrashFileItem, "id" | "kind" | "updatedAt" | "deletedAt">[] = []
  const fs = createTrashFileSystem({
    async list() {
      return source
    },
    async collectionVersion(snapshot) {
      captured = snapshot
      hashing.resolve()
      await releaseHash.promise
      return "trash-v2:frozen-read"
    },
  })
  const reading = fs.read(trashRootRef, {
    actor: "ui",
    permissions: [],
    intent: "content",
  })
  await hashing.promise

  source[0]!.id = "changed"
  source.push({ ...ITEM, id: "late" })
  releaseHash.resolve()

  assert.deepEqual(await reading, {
    data: { count: 1 },
    mediaType: TRASH_ROOT_MEDIA_TYPE,
    version: "trash-v2:frozen-read",
  })
  assert.deepEqual(captured, [
    { id: ITEM.id, kind: ITEM.kind, updatedAt: ITEM.updatedAt, deletedAt: ITEM.deletedAt },
  ])
  assert.equal(Object.isFrozen(captured), true)
  assert.equal(Object.isFrozen(captured[0]), true)
})

test("trash filesystem: empty reuses the snapshot validated before async hashing", async () => {
  const source = [{ ...ITEM }]
  const hashing = deferred()
  const releaseHash = deferred()
  const emptyExpectations: Array<readonly unknown[]> = []
  const fs = createTrashFileSystem({
    async list() {
      return source
    },
    async collectionVersion() {
      hashing.resolve()
      await releaseHash.promise
      return "trash-v2:frozen-action"
    },
    async empty(expected) {
      emptyExpectations.push(expected)
      return expected.length
    },
  })
  const emptying = fs.invoke(
    trashRootRef,
    "empty",
    undefined,
    { actor: "ui", permissions: [], intent: "action" },
    { expectedVersion: "trash-v2:frozen-action" },
  )
  await hashing.promise

  source[0]!.updatedAt = 99
  source.push({ ...ITEM, id: "late" })
  releaseHash.resolve()

  assert.deepEqual(await emptying, { count: 1 })
  assert.deepEqual(emptyExpectations, [
    [{ id: ITEM.id, kind: ITEM.kind, updatedAt: ITEM.updatedAt, deletedAt: ITEM.deletedAt }],
  ])
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

test("trash filesystem: empty is specialized so the confirmation captures a collection version", async () => {
  const { fs } = fixture()
  const actions = await fs.actions(trashRootRef, {
    actor: "ui",
    permissions: [],
    intent: "action",
  })

  assert.deepEqual(
    actions.find((action) => action.id === "empty"),
    {
      id: "empty",
      label: "清空回收站",
      kind: "specialized",
      reason: "需要在回收站界面冻结当前集合版本并确认后执行。",
      risk: "destructive",
      idempotent: true,
      requires: ["delete"],
    },
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
