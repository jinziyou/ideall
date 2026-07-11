import { beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import type { Node, NodeOfKind } from "@protocol/node"
import {
  countTrashItems,
  captureTrashSnapshot,
  listTrashItems,
  restoreTrashItem,
  purgeTrashItem,
} from "./trash-store"
import { updateFileMeta } from "./files-store"
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
    | { children?: Array<{ text?: string }> }
    | undefined
  const restoredThreadMessage = restoredThread?.content.messages[0] as
    | { content?: string }
    | undefined

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

test("updateFileMeta: 快速连续更新仍产生严格递增版本", async () => {
  const initialVersion = Date.now() + 1_000_000
  await idbPut(STORE_NODES, { ...fileNode("f-version"), updatedAt: initialVersion })

  await updateFileMeta("f-version", { name: "first.md" })
  const first = await idbGet<NodeOfKind<"file">>(STORE_NODES, "f-version")
  await updateFileMeta("f-version", { name: "second.md" })
  const second = await idbGet<NodeOfKind<"file">>(STORE_NODES, "f-version")

  assert.equal(first?.updatedAt, initialVersion + 1)
  assert.equal(second?.updatedAt, initialVersion + 2)
})

test("restoreTrashItem: 文件缺少 Blob 快照时不可恢复", async () => {
  const deletedFile = fileNode("f-missing", 700)
  await idbPut(STORE_NODES, deletedFile)
  await captureTrashSnapshot(deletedFile)

  const [item] = await listTrashItems()

  assert.equal(item.restorable, false)
  await assert.rejects(() => restoreTrashItem(deletedFile.id), /文件内容快照不存在/)
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
