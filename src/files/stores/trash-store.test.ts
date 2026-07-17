import { beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import type { Node, NodeOfKind } from "@protocol/node"
import {
  countTrashItems,
  emptyTrash,
  captureTrashSnapshot,
  listTrashItems,
  restoreNoteTrashSubtreeWithRoot,
  restoreTrashItem,
  restoreTrashItemWithNode,
  purgeTrashItem,
} from "./trash-store"
import { restoreNode, restoreNodeWithResult } from "./nodes-store"
import { deleteBookmark, moveBookmark } from "./bookmarks-store"
import { deleteFile, updateFileMeta } from "./files-store"
import { removeSubscription } from "./subscriptions-store"
import { NodeMutationConflictError, nodeMutationExpectation } from "./node-mutation"
import { idbGet, idbPut, STORE_BLOBS, STORE_NODES, STORE_TRASH_SNAPSHOTS } from "@/lib/idb"

type FakeStore = {
  keyPath: string
  indexes: Map<string, string>
  rows: Map<IDBValidKey, unknown>
}

type FakeDbState = {
  stores: Map<string, FakeStore>
}

type FakeRequest<T> = {
  result: T
  error: Error | null
  onsuccess: ((event: Event) => void) | null
  onerror: ((event: Event) => void) | null
}

const fakeDbs = new Map<string, FakeDbState>()

function cloneValue<T>(value: T): T {
  try {
    return structuredClone(value)
  } catch {
    return value
  }
}

function request<T>(): FakeRequest<T> {
  return { result: undefined as T, error: null, onsuccess: null, onerror: null }
}

class FakeObjectStore {
  readonly indexNames = {
    contains: (name: string) => this.store.indexes.has(name),
  } as DOMStringList

  constructor(
    private readonly store: FakeStore,
    private readonly tx: FakeTransaction,
  ) {}

  get(key: IDBValidKey): IDBRequest<unknown> {
    return this.tx.track(() => cloneValue(this.store.rows.get(key)))
  }

  getAll(): IDBRequest<unknown[]> {
    return this.tx.track(() => [...this.store.rows.values()].map(cloneValue))
  }

  put(value: Record<string, unknown>): IDBRequest<IDBValidKey> {
    return this.tx.track(() => {
      const key = value[this.store.keyPath] as IDBValidKey
      this.store.rows.set(key, cloneValue(value))
      return key
    })
  }

  delete(key: IDBValidKey): IDBRequest<undefined> {
    return this.tx.track(() => {
      this.store.rows.delete(key)
      return undefined
    })
  }

  createIndex(name: string, keyPath: string): IDBIndex {
    this.store.indexes.set(name, keyPath)
    return new FakeIndex(this.store, this.tx, keyPath) as unknown as IDBIndex
  }

  index(name: string): IDBIndex {
    const keyPath = this.store.indexes.get(name)
    if (!keyPath) throw new Error(`missing index: ${name}`)
    return new FakeIndex(this.store, this.tx, keyPath) as unknown as IDBIndex
  }
}

class FakeIndex {
  constructor(
    private readonly store: FakeStore,
    private readonly tx: FakeTransaction,
    private readonly keyPath: string,
  ) {}

  getAll(query?: IDBValidKey | IDBKeyRange): IDBRequest<unknown[]> {
    return this.tx.track(() =>
      [...this.store.rows.values()]
        .filter((row) => this.matchesQuery(row, query))
        .sort((a, b) => this.compareIndexKeys(this.indexKey(a), this.indexKey(b)))
        .map(cloneValue),
    )
  }

  count(query?: IDBValidKey | IDBKeyRange): IDBRequest<number> {
    return this.tx.track(
      () => [...this.store.rows.values()].filter((row) => this.matchesQuery(row, query)).length,
    )
  }

  private matchesQuery(row: unknown, query?: IDBValidKey | IDBKeyRange): boolean {
    const key = this.indexKey(row)
    if (key === undefined) return false
    if (query === undefined) return true
    if (typeof query === "object" && "includes" in query && typeof query.includes === "function") {
      return query.includes(key)
    }
    return this.compareIndexKeys(key, query as IDBValidKey) === 0
  }

  private indexKey(row: unknown): IDBValidKey | undefined {
    const value =
      row && typeof row === "object" ? (row as Record<string, unknown>)[this.keyPath] : undefined
    return typeof value === "number" || typeof value === "string" || value instanceof Date
      ? value
      : undefined
  }

  private compareIndexKeys(a: IDBValidKey | undefined, b: IDBValidKey | undefined): number {
    if (a === b) return 0
    if (a === undefined) return 1
    if (b === undefined) return -1
    const left = a instanceof Date ? a.getTime() : a
    const right = b instanceof Date ? b.getTime() : b
    return left < right ? -1 : 1
  }
}

class FakeTransaction {
  oncomplete: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onabort: ((event: Event) => void) | null = null
  error: Error | null = null
  private pending = 0
  private completeQueued = false
  private done = false

  constructor(private readonly state: FakeDbState) {
    queueMicrotask(() => this.maybeComplete())
  }

  objectStore(name: string): FakeObjectStore {
    const store = this.state.stores.get(name)
    if (!store) throw new Error(`missing object store: ${name}`)
    return new FakeObjectStore(store, this)
  }

  abort(): void {
    this.done = true
    this.onabort?.(new Event("abort"))
  }

  track<T>(op: () => T): IDBRequest<T> {
    const req = request<T>()
    this.pending += 1
    queueMicrotask(() => {
      try {
        req.result = op()
        req.onsuccess?.(new Event("success"))
      } catch (error) {
        this.error = error instanceof Error ? error : new Error(String(error))
        req.error = this.error
        req.onerror?.(new Event("error"))
        this.onerror?.(new Event("error"))
      } finally {
        this.pending -= 1
        this.maybeComplete()
      }
    })
    return req as IDBRequest<T>
  }

  private maybeComplete(): void {
    if (this.done || this.pending > 0 || this.completeQueued) return
    this.completeQueued = true
    queueMicrotask(() => {
      this.completeQueued = false
      if (this.done || this.pending > 0) return
      this.done = true
      this.oncomplete?.(new Event("complete"))
    })
  }
}

class FakeDatabase {
  onversionchange: ((event: Event) => void) | null = null
  readonly objectStoreNames = {
    contains: (name: string) => this.state.stores.has(name),
  } as DOMStringList

  constructor(private readonly state: FakeDbState) {}

  createObjectStore(name: string, opts: { keyPath: string }): FakeObjectStore {
    const store = {
      keyPath: opts.keyPath,
      indexes: new Map<string, string>(),
      rows: new Map<IDBValidKey, unknown>(),
    }
    this.state.stores.set(name, store)
    return new FakeObjectStore(store, new FakeTransaction(this.state))
  }

  transaction(storeNames: string | string[], _mode?: IDBTransactionMode): FakeTransaction {
    for (const name of Array.isArray(storeNames) ? storeNames : [storeNames]) {
      if (!this.state.stores.has(name)) throw new Error(`missing object store: ${name}`)
    }
    return new FakeTransaction(this.state)
  }

  close(): void {
    /* no-op */
  }
}

function setupFakeIndexedDb(): void {
  ;(globalThis as typeof globalThis & { indexedDB: IDBFactory }).indexedDB = {
    open(name: string, _version?: number): IDBOpenDBRequest {
      const req = request<IDBDatabase>() as FakeRequest<IDBDatabase> & {
        onupgradeneeded: ((event: Event) => void) | null
        onblocked: ((event: Event) => void) | null
      }
      req.onupgradeneeded = null
      req.onblocked = null
      queueMicrotask(() => {
        let state = fakeDbs.get(name)
        const firstOpen = !state
        if (!state) {
          state = { stores: new Map() }
          fakeDbs.set(name, state)
        }
        req.result = new FakeDatabase(state) as unknown as IDBDatabase
        if (firstOpen) req.onupgradeneeded?.(new Event("upgradeneeded"))
        req.onsuccess?.(new Event("success"))
      })
      return req as IDBOpenDBRequest
    },
  } as IDBFactory
}

function resetFakeIndexedDb(): void {
  for (const db of fakeDbs.values()) {
    for (const store of db.stores.values()) store.rows.clear()
  }
}

setupFakeIndexedDb()

beforeEach(() => {
  resetFakeIndexedDb()
})

function noteNode(id: string, deletedAt?: number): NodeOfKind<"note"> {
  return {
    id,
    kind: "note",
    title: `note-${id}`,
    parentId: null,
    sortKey: id,
    tags: ["unit"],
    createdAt: 1,
    updatedAt: deletedAt ?? 10,
    deletedAt,
    content: [{ type: "p", children: [{ text: `body-${id}` }] }],
  }
}

function fileNode(id: string, deletedAt?: number): NodeOfKind<"file"> {
  return {
    id,
    kind: "file",
    title: `${id}.md`,
    parentId: null,
    sortKey: id,
    tags: ["unit"],
    createdAt: 1,
    updatedAt: deletedAt ?? 10,
    deletedAt,
    blobRef: { store: "blobs", key: id, size: 0, mime: "text/markdown" },
    content: null,
  }
}

function threadNode(id: string, deletedAt?: number): NodeOfKind<"thread"> {
  return {
    id,
    kind: "thread",
    title: `thread-${id}`,
    parentId: null,
    sortKey: id,
    tags: [],
    createdAt: 1,
    updatedAt: deletedAt ?? 10,
    deletedAt,
    content: { messages: [{ role: "user", content: `message-${id}` }] },
  }
}

test("listTrashItems/countTrashItems: 按 deletedAt 列出文件、笔记与对话", async () => {
  await idbPut(STORE_NODES, noteNode("n1", 100))
  await idbPut(STORE_NODES, fileNode("f1", 300))
  await idbPut(STORE_NODES, threadNode("t1", 200))
  await idbPut(STORE_NODES, noteNode("live"))
  await idbPut(STORE_NODES, {
    id: "legacy",
    kind: "legacy",
    title: "legacy",
    parentId: null,
    sortKey: "legacy",
    tags: [],
    createdAt: 1,
    updatedAt: 400,
    deletedAt: 400,
    content: null,
  } as unknown as Node)

  const items = await listTrashItems()

  assert.equal(await countTrashItems(), 3)
  assert.deepEqual(
    items.map((item) => item.id),
    ["f1", "t1", "n1"],
  )
  assert.equal(items.find((item) => item.id === "t1")?.kind, "thread")
  assert.equal(items.find((item) => item.id === "t1")?.detail, "对话线程")
})

test("restoreTrashItem: 用快照恢复笔记、文件 Blob 与对话", async () => {
  const fullNote = noteNode("n-restore")
  const fullFile = fileNode("f-restore")
  const fullThread = threadNode("t-restore")
  const deletedAt = 500
  await idbPut(STORE_NODES, { ...fullNote, content: [], deletedAt, updatedAt: deletedAt })
  await idbPut(STORE_NODES, { ...fullFile, deletedAt, updatedAt: deletedAt })
  await idbPut(STORE_NODES, {
    ...fullThread,
    content: { messages: [] },
    deletedAt,
    updatedAt: deletedAt,
  })
  await captureTrashSnapshot(fullNote)
  await captureTrashSnapshot(fullFile, new Blob(["file-body"], { type: "text/markdown" }))
  await captureTrashSnapshot(fullThread)

  await restoreTrashItem(fullNote.id)
  await restoreTrashItem(fullFile.id)
  await restoreTrashItem(fullThread.id)

  const restoredNote = await idbGet<NodeOfKind<"note">>(STORE_NODES, fullNote.id)
  const restoredFileBlob = await idbGet<{ key: string; blob: Blob }>(STORE_BLOBS, fullFile.id)
  const restoredThread = await idbGet<NodeOfKind<"thread">>(STORE_NODES, fullThread.id)
  const restoredNoteBlock = restoredNote?.content[0] as
    { children?: Array<{ text?: string }> } | undefined
  const restoredThreadMessage = restoredThread?.content.messages[0] as
    { content?: string } | undefined

  assert.equal(restoredNote?.deletedAt, undefined)
  assert.ok((restoredNote?.updatedAt ?? 0) > deletedAt)
  assert.equal(restoredNoteBlock?.children?.[0]?.text, "body-n-restore")
  assert.equal(await restoredFileBlob?.blob.text(), "file-body")
  assert.equal(restoredThreadMessage?.content, "message-t-restore")
  assert.ok((restoredThread?.updatedAt ?? 0) > deletedAt)
  assert.equal(await idbGet(STORE_TRASH_SNAPSHOTS, fullNote.id), undefined)
  assert.equal(await idbGet(STORE_TRASH_SNAPSHOTS, fullFile.id), undefined)
  assert.equal(await idbGet(STORE_TRASH_SNAPSHOTS, fullThread.id), undefined)
})

test("restoreTrashItemWithNode: 返回事务实际提交且完成父级修复的节点", async () => {
  const snapshot = { ...noteNode("n-committed"), parentId: "missing-parent" }
  const deletedAt = 600
  await idbPut(STORE_NODES, {
    ...snapshot,
    content: [],
    deletedAt,
    updatedAt: deletedAt,
  })
  await captureTrashSnapshot(snapshot)

  const committed = await restoreTrashItemWithNode(snapshot.id)
  const stored = await idbGet<NodeOfKind<"note">>(STORE_NODES, snapshot.id)

  assert.deepEqual(committed, stored)
  assert.equal(committed?.parentId, null)
  assert.equal(committed?.deletedAt, undefined)
  assert.ok((committed?.updatedAt ?? 0) > deletedAt)
  assert.deepEqual(committed?.content, snapshot.content)
})

test("restoreNoteTrashSubtreeWithRoot: 返回事务内修复后的 revived root", async () => {
  const rootSnapshot = { ...noteNode("n-tree-root"), parentId: "missing-parent" }
  const childSnapshot = { ...noteNode("n-tree-child"), parentId: rootSnapshot.id }
  const deletedAt = 650
  await idbPut(STORE_NODES, {
    ...rootSnapshot,
    content: [],
    deletedAt,
    updatedAt: deletedAt,
  })
  await idbPut(STORE_NODES, {
    ...childSnapshot,
    content: [],
    deletedAt,
    updatedAt: deletedAt,
  })
  await captureTrashSnapshot(rootSnapshot)
  await captureTrashSnapshot(childSnapshot)

  const committedRoot = await restoreNoteTrashSubtreeWithRoot(rootSnapshot.id)
  const storedRoot = await idbGet<NodeOfKind<"note">>(STORE_NODES, rootSnapshot.id)
  const storedChild = await idbGet<NodeOfKind<"note">>(STORE_NODES, childSnapshot.id)

  assert.deepEqual(committedRoot, storedRoot)
  assert.equal(committedRoot?.parentId, null)
  assert.equal(committedRoot?.deletedAt, undefined)
  assert.deepEqual(committedRoot?.content, rootSnapshot.content)
  assert.equal(storedChild?.parentId, rootSnapshot.id)
  assert.equal(storedChild?.deletedAt, undefined)
  assert.deepEqual(storedChild?.content, childSnapshot.content)
  assert.equal(await idbGet(STORE_TRASH_SNAPSHOTS, rootSnapshot.id), undefined)
  assert.equal(await idbGet(STORE_TRASH_SNAPSHOTS, childSnapshot.id), undefined)
})

test("restoreNodeWithResult: 返回 committed root，并保留 boolean 兼容包装", async () => {
  const committedSnapshot = threadNode("t-node-result")
  const compatibleSnapshot = threadNode("t-node-boolean")
  const deletedAt = 675
  for (const snapshot of [committedSnapshot, compatibleSnapshot]) {
    await idbPut(STORE_NODES, {
      ...snapshot,
      content: { messages: [] },
      deletedAt,
      updatedAt: deletedAt,
    })
    await captureTrashSnapshot(snapshot)
  }

  const committed = await restoreNodeWithResult("thread", committedSnapshot.id)
  const stored = await idbGet<NodeOfKind<"thread">>(STORE_NODES, committedSnapshot.id)

  assert.deepEqual(committed, stored)
  assert.deepEqual(committed?.content, committedSnapshot.content)
  assert.equal(await restoreNode("thread", compatibleSnapshot.id), true)
  assert.equal(await restoreNode("thread", compatibleSnapshot.id), false)
})

test("updateFileMeta: 快速连续更新仍产生严格递增版本", async () => {
  const initialVersion = Date.now() + 1_000_000
  await idbPut(STORE_NODES, { ...fileNode("f-version"), updatedAt: initialVersion })

  const updated = await updateFileMeta("f-version", { name: "first.md" })
  const first = await idbGet<NodeOfKind<"file">>(STORE_NODES, "f-version")
  await updateFileMeta("f-version", { name: "second.md" })
  const second = await idbGet<NodeOfKind<"file">>(STORE_NODES, "f-version")

  assert.equal(updated?.title, "first.md")
  assert.equal(first?.updatedAt, initialVersion + 1)
  assert.equal(second?.updatedAt, initialVersion + 2)
})

test("updateFileMeta: 空 patch 与 tombstone 均保持不变", async () => {
  const live = fileNode("f-meta-noop")
  const tombstone = fileNode("f-meta-deleted", 20)
  await idbPut(STORE_NODES, live)
  await idbPut(STORE_NODES, tombstone)

  assert.equal(await updateFileMeta(live.id, {}), undefined)
  assert.equal(await updateFileMeta(tombstone.id, { name: "must-not-change.md" }), undefined)

  assert.deepEqual(await idbGet(STORE_NODES, live.id), live)
  assert.deepEqual(await idbGet(STORE_NODES, tombstone.id), tombstone)
})

test("live mutation CAS: stale、missing、tombstone 与替换节点在写入前冲突", async () => {
  const file = fileNode("f-cas")
  const deletedFile = fileNode("f-cas-deleted", 20)
  const replacedFile = noteNode("f-cas-replaced")
  const bookmark = {
    id: "bookmark-cas",
    kind: "bookmark",
    title: "bookmark",
    parentId: null,
    sortKey: "bookmark-cas",
    tags: [],
    createdAt: 1,
    updatedAt: 10,
    content: { url: "https://example.com", description: "", favicon: "" },
  } satisfies NodeOfKind<"bookmark">
  const feed = {
    id: "feed:publisher:cas.example",
    kind: "feed",
    title: "feed",
    parentId: null,
    sortKey: "feed-cas",
    tags: [],
    createdAt: 1,
    updatedAt: 10,
    content: { type: "publisher", key: "cas.example", favicon: "" },
  } satisfies NodeOfKind<"feed">
  await idbPut(STORE_NODES, file)
  await idbPut(STORE_NODES, deletedFile)
  await idbPut(STORE_NODES, replacedFile)
  await idbPut(STORE_NODES, bookmark)
  await idbPut(STORE_NODES, feed)
  const stale = <T extends Node>(node: T) => ({
    ...nodeMutationExpectation(node),
    updatedAt: node.updatedAt - 1,
  })

  await assert.rejects(
    () => updateFileMeta(file.id, { name: "stale.md" }, stale(file)),
    NodeMutationConflictError,
  )
  await assert.rejects(
    () => moveBookmark(bookmark.id, null, undefined, stale(bookmark)),
    NodeMutationConflictError,
  )
  await assert.rejects(
    () => removeSubscription("publisher", "cas.example", stale(feed)),
    NodeMutationConflictError,
  )
  await assert.rejects(
    () =>
      updateFileMeta(
        "missing-file",
        { name: "missing.md" },
        { kind: "file", updatedAt: 1, deletedAt: null },
      ),
    NodeMutationConflictError,
  )
  await assert.rejects(
    () =>
      updateFileMeta(
        deletedFile.id,
        { name: "deleted.md" },
        { kind: "file", updatedAt: 10, deletedAt: null },
      ),
    NodeMutationConflictError,
  )
  await assert.rejects(
    () =>
      updateFileMeta(
        replacedFile.id,
        { name: "replaced.md" },
        { kind: "file", updatedAt: replacedFile.updatedAt, deletedAt: null },
      ),
    NodeMutationConflictError,
  )

  assert.deepEqual(await idbGet(STORE_NODES, file.id), file)
  assert.deepEqual(await idbGet(STORE_NODES, deletedFile.id), deletedFile)
  assert.deepEqual(await idbGet(STORE_NODES, replacedFile.id), replacedFile)
  assert.deepEqual(await idbGet(STORE_NODES, bookmark.id), bookmark)
  assert.deepEqual(await idbGet(STORE_NODES, feed.id), feed)
})

test("live mutation delete: 首次删除返回 true，幂等重试返回 false", async () => {
  const file = fileNode("f-delete-result")
  const bookmark = {
    id: "bookmark-delete-result",
    kind: "bookmark",
    title: "bookmark",
    parentId: null,
    sortKey: "bookmark-delete-result",
    tags: [],
    createdAt: 1,
    updatedAt: 10,
    content: { url: "https://example.com/delete", description: "", favicon: "" },
  } satisfies NodeOfKind<"bookmark">
  await idbPut(STORE_NODES, file)
  await idbPut(STORE_BLOBS, { key: file.id, blob: new Blob(["body"]) })
  await idbPut(STORE_NODES, bookmark)

  assert.equal(await deleteFile(file.id, nodeMutationExpectation(file)), true)
  assert.equal(await deleteFile(file.id), false)
  assert.equal(await deleteBookmark(bookmark.id, nodeMutationExpectation(bookmark)), true)
  assert.equal(await deleteBookmark(bookmark.id), false)
})

test("restoreTrashItem: 文件缺少 Blob 快照时不可恢复", async () => {
  const deletedFile = fileNode("f-missing", 700)
  await idbPut(STORE_NODES, deletedFile)
  await captureTrashSnapshot(deletedFile)

  const [item] = await listTrashItems()

  assert.equal(item.restorable, false)
  await assert.rejects(() => restoreTrashItem(deletedFile.id), /文件内容快照不存在/)
})

test("listTrashItems: id/kind 不匹配的快照不得被声称为可恢复", async () => {
  const deletedFile = fileNode("f-corrupt-snapshot", 710)
  await idbPut(STORE_NODES, deletedFile)
  await idbPut(STORE_TRASH_SNAPSHOTS, {
    id: deletedFile.id,
    node: noteNode("different-node"),
    blob: new Blob(["wrong body"]),
    capturedAt: 710,
  })

  const [item] = await listTrashItems()

  assert.equal(item.id, deletedFile.id)
  assert.equal(item.snapshot, false)
  assert.equal(item.restorable, false)
  await assert.rejects(() => restoreTrashItem(deletedFile.id), /文件内容快照不存在或不匹配/)
})

test("purgeTrashItem: 永久删除节点、Blob 与回收站快照", async () => {
  const deletedFile = fileNode("f-purge", 900)
  await idbPut(STORE_NODES, deletedFile)
  await idbPut(STORE_BLOBS, { key: deletedFile.id, blob: new Blob(["purge-body"]) })
  await captureTrashSnapshot(deletedFile, new Blob(["purge-body"]))

  await purgeTrashItem(deletedFile.id)

  assert.equal(await idbGet(STORE_NODES, deletedFile.id), undefined)
  assert.equal(await idbGet(STORE_BLOBS, deletedFile.id), undefined)
  assert.equal(await idbGet(STORE_TRASH_SNAPSHOTS, deletedFile.id), undefined)
  assert.equal(await countTrashItems(), 0)
})

test("purgeTrashItem: 恢复后的 live 节点不会被陈旧清理请求删除", async () => {
  const live = noteNode("n-live")
  await idbPut(STORE_NODES, live)
  await captureTrashSnapshot({ ...live, deletedAt: 800 })

  await purgeTrashItem(live.id)

  assert.deepEqual(await idbGet(STORE_NODES, live.id), live)
  assert.ok(await idbGet(STORE_TRASH_SNAPSHOTS, live.id))
})

test("emptyTrash: 事务内集合与确认快照不一致时不删除新一代墓碑", async () => {
  const first = { ...noteNode("empty-first"), deletedAt: 100, updatedAt: 100 }
  const late = { ...noteNode("empty-late"), deletedAt: 110, updatedAt: 110 }
  await idbPut(STORE_NODES, first)
  const expected = [
    { id: first.id, kind: first.kind, updatedAt: first.updatedAt, deletedAt: first.deletedAt },
  ]
  await idbPut(STORE_NODES, late)

  assert.equal(await emptyTrash(expected), null)
  assert.ok(await idbGet(STORE_NODES, first.id))
  assert.ok(await idbGet(STORE_NODES, late.id))

  assert.equal(
    await emptyTrash([
      ...expected,
      { id: late.id, kind: late.kind, updatedAt: late.updatedAt, deletedAt: late.deletedAt },
    ]),
    2,
  )
})

test("emptyTrash: 同数量但身份已替换的墓碑集合不会被陈旧确认删除", async () => {
  const confirmed = { ...noteNode("empty-confirmed"), deletedAt: 100, updatedAt: 100 }
  const replacement = { ...noteNode("empty-replacement"), deletedAt: 110, updatedAt: 110 }
  await idbPut(STORE_NODES, replacement)

  assert.equal(
    await emptyTrash([
      {
        id: confirmed.id,
        kind: confirmed.kind,
        updatedAt: confirmed.updatedAt,
        deletedAt: confirmed.deletedAt,
      },
    ]),
    null,
  )
  assert.deepEqual(await idbGet(STORE_NODES, replacement.id), replacement)
})
