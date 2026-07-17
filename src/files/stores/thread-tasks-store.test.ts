import assert from "node:assert/strict"
import { beforeEach, test } from "node:test"
import { FILES_UPDATED, type FilesUpdate } from "@protocol/flowback"
import { MAX_THREAD_TASK_ITEMS, ThreadTaskConflictError, type ThreadTask } from "@protocol/files"
import type { NodeOfKind } from "@protocol/node"
import { StorageSyncConflictError, type BookmarkSyncNode } from "@protocol/storage-sync"
import {
  addBookmark,
  addFolder,
  bulkPutBookmarkNodes,
  captureBookmark,
  deleteBookmark,
  deleteFolder,
  listAllBookmarkNodes,
  listBookmarks,
  moveBookmark,
  moveFolder,
  restoreBookmark,
} from "./bookmarks-store"
import { addFile, addFileWithNode, deleteFile, restoreFile, updateFileContent } from "./files-store"
import {
  addNote,
  bulkPutNotes,
  deleteNote,
  listAllNotes,
  moveNote,
  restoreSubtree,
} from "./notes-store"
import { createNode, deleteNode, restoreNode, updateNode } from "./nodes-store"
import { NodeMutationConflictError, nodeMutationExpectation } from "./node-mutation"
import {
  addSubscription,
  bulkPutSubscriptions,
  listAllSubscriptions,
  removeSubscription,
} from "./subscriptions-store"
import {
  emptyTrash,
  purgeTrashItem,
  restoreNoteTrashSubtree,
  restoreTrashItem,
} from "./trash-store"
import { createThread } from "./threads-store"
import {
  attachThreadTask,
  createTaskThread,
  deleteTaskThread,
  listThreadTasks,
  migrateLegacyThreadTasks,
  readThreadTaskIndexHead,
  replaceThreadTasks,
  saveThreadAndTouchTaskAtomic,
  updateThreadTask,
} from "./thread-tasks-store"
import { listNodeSummaryPage } from "./nodes-store"
import {
  IDB_DATABASE_NAME,
  IDB_DATABASE_VERSION,
  INDEX_AGENT_WRITE_AUDIT_UPDATED_AT,
  INDEX_NODES_KIND,
  INDEX_NODES_KIND_SORT_KEY,
  INDEX_NODES_KIND_SORT_TITLE_ID,
  INDEX_NODES_THREAD_METADATA,
  idbGet,
  idbPut,
  STORE_BLOBS,
  STORE_AGENT_TASKS,
  STORE_AGENT_WRITE_AUDIT,
  STORE_NODES,
  STORE_LOCAL_SEARCH_INDEX,
  STORE_LOCAL_SEMANTIC_INDEX,
  STORE_TRASH_SNAPSHOTS,
} from "@/lib/idb"
import { feedNodeId } from "@/files/feed-node"
import {
  deleteLocalSearchIndexDocument,
  localSearchIndexDocumentKey,
  putLocalSearchIndexDocument,
  readLocalSearchIndex,
  replaceLocalSearchIndex,
  type LocalSearchIndexDocument,
} from "@/files/local-search-index-store"
import {
  createLocalSemanticVector,
  deleteLocalSemanticVector,
  putLocalSemanticVector,
  readLocalSemanticIndex,
  replaceLocalSemanticIndex,
} from "@/files/local-semantic-index-store"
import {
  LOCAL_SEMANTIC_MODEL_ID,
  LOCAL_SEMANTIC_VECTOR_DIMENSIONS,
} from "@/lib/local-semantic-contract"

type FakeStore = {
  keyPath: string
  indexes: Map<string, string | string[]>
  rows: Map<IDBValidKey, unknown>
}

type FakeDbState = {
  stores: Map<string, FakeStore>
  writeTail: Promise<void>
}

type FakeRequest<T> = {
  result: T
  error: Error | null
  onsuccess: ((event: Event) => void) | null
  onerror: ((event: Event) => void) | null
}

type FakeKeyRange = {
  readonly lower: IDBValidKey
  readonly upper: IDBValidKey
  readonly lowerOpen: boolean
  readonly upperOpen: boolean
}

const fakeDbs = new Map<string, FakeDbState>()
let failNextWriteStore: string | null = null
let abortNextReadwriteCommit = false
const getAllCalls = new Map<string, number>()
const indexGetAllModes = new Map<string, IDBTransactionMode[]>()
const objectStoreGetModes = new Map<string, IDBTransactionMode[]>()
const keyCursorCalls = new Map<string, number>()
const keyCursorVisits = new Map<string, number>()

function failInjectedWrite(storeName: string): void {
  if (failNextWriteStore !== storeName) return
  failNextWriteStore = null
  throw new Error(`injected ${storeName} write failure`)
}

function cloneValue<T>(value: T): T {
  return structuredClone(value)
}

function request<T>(): FakeRequest<T> {
  return { result: undefined as T, error: null, onsuccess: null, onerror: null }
}

function indexKey(row: unknown, keyPath: string | string[]): IDBValidKey | undefined {
  if (!row || typeof row !== "object") return undefined
  const record = row as Record<string, unknown>
  if (Array.isArray(keyPath)) {
    const values = keyPath.map((key) => record[key])
    if (values.some((value) => value === undefined)) return undefined
    return values as IDBValidKey[]
  }
  const value = record[keyPath]
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    value instanceof Date ||
    Array.isArray(value)
  ) {
    return value as IDBValidKey
  }
  return undefined
}

function compareKeys(left: IDBValidKey, right: IDBValidKey): number {
  const rank = (value: IDBValidKey): number => {
    if (typeof value === "number") return 1
    if (value instanceof Date) return 2
    if (typeof value === "string") return 3
    if (Array.isArray(value)) return 5
    return 4
  }
  const rankDifference = rank(left) - rank(right)
  if (rankDifference !== 0) return rankDifference
  if (Array.isArray(left) && Array.isArray(right)) {
    const length = Math.min(left.length, right.length)
    for (let index = 0; index < length; index += 1) {
      const result = compareKeys(left[index] as IDBValidKey, right[index] as IDBValidKey)
      if (result !== 0) return result
    }
    return left.length - right.length
  }
  const a = left instanceof Date ? left.getTime() : left
  const b = right instanceof Date ? right.getTime() : right
  if (a === b) return 0
  return a < b ? -1 : 1
}

function isFakeKeyRange(value: unknown): value is FakeKeyRange {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    "lower" in (value as object) &&
    "upper" in (value as object)
  )
}

function matchesQuery(key: IDBValidKey, query?: IDBValidKey | IDBKeyRange): boolean {
  if (query === undefined) return true
  if (!isFakeKeyRange(query)) return compareKeys(key, query as IDBValidKey) === 0
  const lower = compareKeys(key, query.lower)
  const upper = compareKeys(key, query.upper)
  return (query.lowerOpen ? lower > 0 : lower >= 0) && (query.upperOpen ? upper < 0 : upper <= 0)
}

class FakeObjectStore {
  readonly indexNames = {
    contains: (name: string) => this.store.indexes.has(name),
  } as DOMStringList

  constructor(
    private readonly name: string,
    private readonly store: FakeStore,
    private readonly transaction: FakeTransaction,
  ) {}

  get(key: IDBValidKey): IDBRequest<unknown> {
    const modes = objectStoreGetModes.get(this.name) ?? []
    modes.push(this.transaction.mode)
    objectStoreGetModes.set(this.name, modes)
    return this.transaction.track(() => cloneValue(this.store.rows.get(key)))
  }

  getAll(): IDBRequest<unknown[]> {
    getAllCalls.set(this.name, (getAllCalls.get(this.name) ?? 0) + 1)
    return this.transaction.track(() => [...this.store.rows.values()].map(cloneValue))
  }

  put(value: Record<string, unknown>): IDBRequest<IDBValidKey> {
    return this.transaction.track(() => {
      failInjectedWrite(this.name)
      const key = value[this.store.keyPath] as IDBValidKey
      this.store.rows.set(key, cloneValue(value))
      return key
    })
  }

  add(value: Record<string, unknown>): IDBRequest<IDBValidKey> {
    return this.transaction.track(() => {
      failInjectedWrite(this.name)
      const key = value[this.store.keyPath] as IDBValidKey
      if (this.store.rows.has(key)) throw new Error(`duplicate key: ${String(key)}`)
      this.store.rows.set(key, cloneValue(value))
      return key
    })
  }

  delete(key: IDBValidKey): IDBRequest<undefined> {
    return this.transaction.track(() => {
      failInjectedWrite(this.name)
      this.store.rows.delete(key)
      return undefined
    })
  }

  clear(): IDBRequest<undefined> {
    return this.transaction.track(() => {
      failInjectedWrite(this.name)
      this.store.rows.clear()
      return undefined
    })
  }

  createIndex(name: string, keyPath: string | string[]): IDBIndex {
    this.store.indexes.set(name, keyPath)
    return new FakeIndex(name, this.store, this.transaction, keyPath) as unknown as IDBIndex
  }

  index(name: string): IDBIndex {
    const keyPath = this.store.indexes.get(name)
    if (!keyPath) throw new Error(`missing index: ${name}`)
    return new FakeIndex(name, this.store, this.transaction, keyPath) as unknown as IDBIndex
  }
}

class FakeIndex {
  constructor(
    private readonly name: string,
    private readonly store: FakeStore,
    private readonly transaction: FakeTransaction,
    private readonly keyPath: string | string[],
  ) {}

  getAll(query?: IDBValidKey | IDBKeyRange): IDBRequest<unknown[]> {
    getAllCalls.set(this.name, (getAllCalls.get(this.name) ?? 0) + 1)
    const modes = indexGetAllModes.get(this.name) ?? []
    modes.push(this.transaction.mode)
    indexGetAllModes.set(this.name, modes)
    return this.transaction.track(() =>
      this.entries(query).map((entry) => cloneValue(this.store.rows.get(entry.primaryKey))),
    )
  }

  getAllKeys(): IDBRequest<IDBValidKey[]> {
    return this.transaction.track(() => this.entries().map((entry) => cloneValue(entry.primaryKey)))
  }

  openKeyCursor(
    query?: IDBValidKey | IDBKeyRange,
    direction: IDBCursorDirection = "next",
  ): IDBRequest<IDBCursor | null> {
    keyCursorCalls.set(this.name, (keyCursorCalls.get(this.name) ?? 0) + 1)
    const req = request<IDBCursor | null>()
    this.transaction.trackCursor(
      req,
      () => this.entries(query, direction),
      () => {
        keyCursorVisits.set(this.name, (keyCursorVisits.get(this.name) ?? 0) + 1)
      },
    )
    return req as IDBRequest<IDBCursor | null>
  }

  openCursor(
    query?: IDBValidKey | IDBKeyRange,
    direction: IDBCursorDirection = "next",
  ): IDBRequest<IDBCursorWithValue | null> {
    const req = request<IDBCursorWithValue | null>()
    this.transaction.trackCursor(
      req as FakeRequest<IDBCursor | null>,
      () => this.entries(query, direction),
      () => {},
      (primaryKey) => cloneValue(this.store.rows.get(primaryKey)),
    )
    return req as IDBRequest<IDBCursorWithValue | null>
  }

  private entries(
    query?: IDBValidKey | IDBKeyRange,
    direction: IDBCursorDirection = "next",
  ): Array<{ key: IDBValidKey; primaryKey: IDBValidKey }> {
    const entries: Array<{ key: IDBValidKey; primaryKey: IDBValidKey }> = []
    for (const [primaryKey, row] of this.store.rows) {
      const key = indexKey(row, this.keyPath)
      if (key !== undefined && matchesQuery(key, query)) entries.push({ key, primaryKey })
    }
    entries.sort(
      (left, right) =>
        compareKeys(left.key, right.key) || compareKeys(left.primaryKey, right.primaryKey),
    )
    return direction === "prev" || direction === "prevunique" ? entries.reverse() : entries
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
  private readonly before = new Map<string, Map<IDBValidKey, unknown>>()
  private readonly scope: Set<string>
  private readonly queued: Array<() => void> = []
  private active = false
  private gateReleased = false

  constructor(
    private readonly state: FakeDbState,
    storeNames: readonly string[],
    readonly mode: IDBTransactionMode = "readonly",
    start: Promise<void> = Promise.resolve(),
    private readonly releaseGate: () => void = () => {},
  ) {
    this.scope = new Set(storeNames)
    for (const name of storeNames) {
      const store = state.stores.get(name)
      if (!store) throw new Error(`missing object store: ${name}`)
    }
    void start.then(() => this.begin())
  }

  objectStore(name: string): FakeObjectStore {
    const store = this.state.stores.get(name)
    if (!store || !this.scope.has(name)) throw new Error(`store not in transaction: ${name}`)
    return new FakeObjectStore(name, store, this)
  }

  abort(): void {
    if (this.done) throw new Error("transaction already completed")
    this.done = true
    this.rollback()
    this.release()
    this.onabort?.(new Event("abort"))
  }

  track<T>(operation: () => T): IDBRequest<T> {
    const req = request<T>()
    this.pending += 1
    this.enqueue(() => {
      queueMicrotask(() => {
        if (this.done) return
        try {
          req.result = operation()
          req.onsuccess?.(new Event("success"))
        } catch (error) {
          this.fail(error, req)
        } finally {
          this.pending -= 1
          this.maybeComplete()
        }
      })
    })
    return req as IDBRequest<T>
  }

  trackCursor(
    req: FakeRequest<IDBCursor | null>,
    readEntries: () => Array<{ key: IDBValidKey; primaryKey: IDBValidKey }>,
    onVisit: () => void = () => {},
    valueFor?: (primaryKey: IDBValidKey) => unknown,
  ): void {
    this.pending += 1
    this.enqueue(() => {
      const entries = readEntries()
      let index = 0
      const emit = () => {
        queueMicrotask(() => {
          if (this.done) return
          if (index >= entries.length) {
            req.result = null
            req.onsuccess?.(new Event("success"))
            this.pending -= 1
            this.maybeComplete()
            return
          }
          const entry = entries[index]
          onVisit()
          let continued = false
          req.result = {
            key: cloneValue(entry.key),
            primaryKey: cloneValue(entry.primaryKey),
            ...(valueFor ? { value: valueFor(entry.primaryKey) } : {}),
            continue: () => {
              if (continued) throw new Error("cursor continued twice")
              continued = true
              index += 1
              emit()
            },
          } as IDBCursor
          req.onsuccess?.(new Event("success"))
          if (!continued) {
            this.pending -= 1
            this.maybeComplete()
          }
        })
      }
      emit()
    })
  }

  private begin(): void {
    if (this.done) return
    for (const name of this.scope) {
      const store = this.state.stores.get(name)
      if (!store) continue
      this.before.set(
        name,
        new Map([...store.rows].map(([key, value]) => [key, cloneValue(value)])),
      )
    }
    this.active = true
    const queued = this.queued.splice(0)
    for (const run of queued) run()
    queueMicrotask(() => this.maybeComplete())
  }

  private enqueue(run: () => void): void {
    if (this.active) run()
    else this.queued.push(run)
  }

  private fail<T>(error: unknown, req: FakeRequest<T>): void {
    this.error = error instanceof Error ? error : new Error(String(error))
    req.error = this.error
    req.onerror?.(new Event("error"))
    this.done = true
    this.rollback()
    this.release()
    this.onerror?.(new Event("error"))
    this.onabort?.(new Event("abort"))
  }

  private rollback(): void {
    for (const [name, rows] of this.before) {
      const store = this.state.stores.get(name)
      if (!store) continue
      store.rows = new Map([...rows].map(([key, value]) => [key, cloneValue(value)]))
    }
  }

  private maybeComplete(): void {
    if (!this.active || this.done || this.pending > 0 || this.completeQueued) return
    this.completeQueued = true
    queueMicrotask(() => {
      this.completeQueued = false
      if (this.done || this.pending > 0) return
      if (this.mode === "readwrite" && abortNextReadwriteCommit) {
        abortNextReadwriteCommit = false
        this.error = new Error("injected readwrite commit abort")
        this.done = true
        this.rollback()
        this.release()
        this.onabort?.(new Event("abort"))
        return
      }
      this.done = true
      this.release()
      this.oncomplete?.(new Event("complete"))
    })
  }

  private release(): void {
    if (this.gateReleased) return
    this.gateReleased = true
    this.releaseGate()
  }
}

class FakeDatabase {
  onversionchange: ((event: Event) => void) | null = null
  readonly objectStoreNames = {
    contains: (name: string) => this.state.stores.has(name),
  } as DOMStringList

  constructor(private readonly state: FakeDbState) {}

  createObjectStore(name: string, options: { keyPath: string }): FakeObjectStore {
    const store: FakeStore = {
      keyPath: options.keyPath,
      indexes: new Map(),
      rows: new Map(),
    }
    this.state.stores.set(name, store)
    return new FakeObjectStore(
      name,
      store,
      new FakeTransaction(this.state, [name], "versionchange"),
    )
  }

  transaction(
    storeNames: string | string[],
    mode: IDBTransactionMode = "readonly",
  ): FakeTransaction {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames]
    if (mode !== "readwrite") return new FakeTransaction(this.state, names, mode)

    const start = this.state.writeTail
    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    this.state.writeTail = start.then(() => current)
    return new FakeTransaction(this.state, names, mode, start, release)
  }

  close(): void {
    // no-op
  }
}

function setupFakeIndexedDb(): void {
  Object.defineProperty(globalThis, "IDBKeyRange", {
    value: {
      bound(
        lower: IDBValidKey,
        upper: IDBValidKey,
        lowerOpen = false,
        upperOpen = false,
      ): IDBKeyRange {
        return { lower, upper, lowerOpen, upperOpen } as IDBKeyRange
      },
      only(value: IDBValidKey): IDBKeyRange {
        return { lower: value, upper: value, lowerOpen: false, upperOpen: false } as IDBKeyRange
      },
    },
    configurable: true,
  })
  ;(globalThis as typeof globalThis & { indexedDB: IDBFactory }).indexedDB = {
    open(name: string): IDBOpenDBRequest {
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
          state = { stores: new Map(), writeTail: Promise.resolve() }
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
  failNextWriteStore = null
  abortNextReadwriteCommit = false
  getAllCalls.clear()
  indexGetAllModes.clear()
  objectStoreGetModes.clear()
  keyCursorCalls.clear()
  keyCursorVisits.clear()
  for (const db of fakeDbs.values()) {
    db.writeTail = Promise.resolve()
    for (const store of db.stores.values()) store.rows.clear()
  }
}

setupFakeIndexedDb()

beforeEach(() => {
  resetFakeIndexedDb()
})

test("capture bookmark: canonical URL deduplication is atomic and keeps searchable metadata", async () => {
  const results = await Promise.all([
    captureBookmark({
      title: "Research A",
      url: "https://EXAMPLE.com:443/research#first",
      description: "Searchable finding",
      tags: ["收件箱"],
    }),
    captureBookmark({
      title: "Research B",
      url: "https://example.com/research#second",
      description: "Duplicate finding",
      tags: ["收件箱"],
    }),
  ])

  assert.equal(results.filter((result) => result.status === "created").length, 1)
  assert.equal(results.filter((result) => result.status === "existing").length, 1)
  assert.equal(results[0]?.bookmark.id, results[1]?.bookmark.id)
  const bookmarks = await listBookmarks()
  assert.equal(bookmarks.length, 1)
  assert.deepEqual(bookmarks[0]?.tags, ["收件箱"])
  assert.equal(bookmarks[0]?.description, "Searchable finding")
})

test("capture bookmark: rejects unsafe protocols before opening a write transaction", async () => {
  await assert.rejects(
    () =>
      captureBookmark({
        title: "Unsafe",
        url: "javascript:alert(1)",
        tags: ["收件箱"],
      }),
    /HTTP\(S\)/,
  )
  assert.deepEqual(await listBookmarks(), [])
})

function threadNode(id: string, deletedAt?: number): NodeOfKind<"thread"> {
  return {
    id,
    kind: "thread",
    title: `thread-${id}`,
    parentId: null,
    sortKey: `a${id}`,
    tags: [],
    createdAt: 10,
    updatedAt: deletedAt ?? 20,
    deletedAt,
    content: { messages: [{ role: "user", content: id }] },
  }
}

function storedNote(
  id: string,
  parentId: string | null,
  sortKey: string,
  deletedAt?: number,
): NodeOfKind<"note"> {
  return {
    id,
    kind: "note",
    title: id,
    parentId,
    sortKey,
    tags: [],
    createdAt: 1,
    updatedAt: deletedAt ?? 2,
    deletedAt,
    content: [],
  }
}

function storedBookmark(
  id: string,
  parentId: string | null,
  sortKey: string,
): NodeOfKind<"bookmark"> {
  return {
    id,
    kind: "bookmark",
    title: id,
    parentId,
    sortKey,
    tags: [],
    createdAt: 1,
    updatedAt: 2,
    content: { url: `https://${id}.example`, description: "", favicon: "" },
  }
}

function storedFolder(id: string, sortKey: string, deletedAt?: number): NodeOfKind<"folder"> {
  return {
    id,
    kind: "folder",
    title: id,
    parentId: null,
    sortKey,
    tags: [],
    createdAt: 1,
    updatedAt: deletedAt ?? 2,
    deletedAt,
    content: null,
  }
}

function storedFile(id: string, deletedAt?: number): NodeOfKind<"file"> {
  return {
    id,
    kind: "file",
    title: `${id}.txt`,
    parentId: null,
    sortKey: `a${id}`,
    tags: [],
    createdAt: 1,
    updatedAt: deletedAt ?? 2,
    deletedAt,
    blobRef: { store: "blobs", key: id, size: 4, mime: "text/plain" },
    content: null,
  }
}

async function seedLiveFile(id: string, content = "body"): Promise<NodeOfKind<"file">> {
  const blob = new Blob([content], { type: "text/plain" })
  const node = {
    ...storedFile(id),
    blobRef: { store: "blobs", key: id, size: blob.size, mime: blob.type },
  } satisfies NodeOfKind<"file">
  await idbPut(STORE_NODES, node)
  await idbPut(STORE_BLOBS, { key: id, blob })
  return node
}

async function assertCoherentFileLifecycle(
  id: string,
  expectedContent: string,
): Promise<"live" | "tombstone"> {
  const node = await idbGet<NodeOfKind<"file">>(STORE_NODES, id)
  const blobRecord = await idbGet<{ key: string; blob: Blob }>(STORE_BLOBS, id)
  const snapshot = await idbGet<{
    id: string
    node: NodeOfKind<"file">
    blob?: Blob
    capturedAt: number
  }>(STORE_TRASH_SNAPSHOTS, id)
  assert.ok(node)

  if (node.deletedAt == null) {
    assert.ok(blobRecord)
    assert.equal(await blobRecord.blob.text(), expectedContent)
    assert.equal(snapshot, undefined)
    return "live"
  }

  assert.equal(blobRecord, undefined)
  assert.ok(snapshot)
  assert.equal(snapshot.node.deletedAt, undefined)
  assert.ok(snapshot.blob)
  assert.equal(await snapshot.blob.text(), expectedContent)
  return "tombstone"
}

function task(id: string, updatedAt = 20, workspaceId = "workspace-a"): ThreadTask {
  return {
    id,
    workspaceId,
    status: "active",
    starred: false,
    createdAt: 10,
    updatedAt,
  }
}

test("schema/list: v20 adds the optional semantic index and keeps existing stores", async () => {
  assert.equal(IDB_DATABASE_NAME, "wonita-home")
  assert.equal(IDB_DATABASE_VERSION, 20)
  assert.deepEqual(await listThreadTasks(), { revision: 0, tasks: [] })
  assert.deepEqual(await readThreadTaskIndexHead(), { revision: 0, count: 0 })
  assert.ok(fakeDbs.get(IDB_DATABASE_NAME)?.stores.has(STORE_AGENT_TASKS))
  assert.equal(fakeDbs.get(IDB_DATABASE_NAME)?.stores.get(STORE_AGENT_TASKS)?.keyPath, "key")
  assert.equal(fakeDbs.get(IDB_DATABASE_NAME)?.stores.get(STORE_LOCAL_SEARCH_INDEX)?.keyPath, "key")
  assert.equal(
    fakeDbs.get(IDB_DATABASE_NAME)?.stores.get(STORE_LOCAL_SEMANTIC_INDEX)?.keyPath,
    "key",
  )
  assert.equal(fakeDbs.get(IDB_DATABASE_NAME)?.stores.get(STORE_AGENT_WRITE_AUDIT)?.keyPath, "id")
  assert.equal(
    fakeDbs
      .get(IDB_DATABASE_NAME)
      ?.stores.get(STORE_AGENT_WRITE_AUDIT)
      ?.indexes.get(INDEX_AGENT_WRITE_AUDIT_UPDATED_AT),
    "updatedAt",
  )
  assert.deepEqual(
    fakeDbs.get(IDB_DATABASE_NAME)?.stores.get(STORE_NODES)?.indexes.get(INDEX_NODES_KIND_SORT_KEY),
    ["kind", "sortKey"],
  )
  assert.deepEqual(
    fakeDbs
      .get(IDB_DATABASE_NAME)
      ?.stores.get(STORE_NODES)
      ?.indexes.get(INDEX_NODES_KIND_SORT_TITLE_ID),
    ["kind", "sortKey", "title", "id"],
  )
})

test("local search index store: rebuild, incremental upsert and delete keep a consistent head", async () => {
  const document = (id: string, value: string): LocalSearchIndexDocument => {
    const target = { fileSystemId: "ideall.core", fileId: `resource:node:note:${id}` }
    return {
      key: localSearchIndexDocumentKey(target),
      type: "document",
      target,
      group: "文件",
      kind: "note",
      label: id,
      fields: [{ label: "正文", value }],
      sourceVersion: "1",
      indexedAt: 1,
    }
  }
  const first = document("first", "alpha")
  const second = document("second", "beta")

  await replaceLocalSearchIndex([first])
  assert.deepEqual((await readLocalSearchIndex()).documents, [first])

  await putLocalSearchIndexDocument(second)
  assert.deepEqual((await readLocalSearchIndex()).documents.map((item) => item.label).sort(), [
    "first",
    "second",
  ])

  await putLocalSearchIndexDocument({ ...second, fields: [{ label: "正文", value: "updated" }] })
  const updated = await readLocalSearchIndex()
  assert.equal(updated.ready, true)
  assert.equal(updated.documents.length, 2)
  assert.equal(
    updated.documents.find((item) => item.label === "second")?.fields[0]?.value,
    "updated",
  )

  await deleteLocalSearchIndexDocument(first.target)
  assert.deepEqual(
    (await readLocalSearchIndex()).documents.map((item) => item.label),
    ["second"],
  )

  await idbPut(STORE_LOCAL_SEARCH_INDEX, {
    ...second,
    fields: [{ label: "正文", value: 42 }],
  })
  assert.equal((await readLocalSearchIndex()).ready, false)
})

test("local semantic index store: rebuild, upsert, delete and corruption stay bounded", async () => {
  const vector = (seed: number) =>
    Float32Array.from(
      { length: LOCAL_SEMANTIC_VECTOR_DIMENSIONS },
      (_, index) => seed + index / 1000,
    )
  const first = createLocalSemanticVector(
    "document:first",
    "1",
    LOCAL_SEMANTIC_MODEL_ID,
    vector(1),
    10,
  )
  const second = createLocalSemanticVector(
    "document:second",
    "1",
    LOCAL_SEMANTIC_MODEL_ID,
    vector(2),
    20,
  )

  await replaceLocalSemanticIndex(LOCAL_SEMANTIC_MODEL_ID, [first])
  assert.deepEqual((await readLocalSemanticIndex()).vectors, [first])

  await putLocalSemanticVector(second)
  const inserted = await readLocalSemanticIndex()
  assert.equal(inserted.ready, true)
  assert.deepEqual(inserted.vectors.map((item) => item.documentKey).sort(), [
    "document:first",
    "document:second",
  ])

  const updatedSecond = createLocalSemanticVector(
    "document:second",
    "2",
    LOCAL_SEMANTIC_MODEL_ID,
    vector(3),
    30,
  )
  await putLocalSemanticVector(updatedSecond)
  assert.equal((await readLocalSemanticIndex()).vectors.length, 2)
  assert.equal(
    (await readLocalSemanticIndex()).vectors.find((item) => item.documentKey === "document:second")
      ?.sourceVersion,
    "2",
  )

  await deleteLocalSemanticVector("document:first")
  assert.deepEqual(
    (await readLocalSemanticIndex()).vectors.map((item) => item.documentKey),
    ["document:second"],
  )

  await idbPut(STORE_LOCAL_SEMANTIC_INDEX, {
    ...updatedSecond,
    vector: new Float32Array(1),
  })
  assert.equal((await readLocalSemanticIndex()).ready, false)
})

test("node summary paging: index cursor merges kinds without nodes getAll", async () => {
  const row = (
    id: string,
    kind: "note" | "file",
    sortKey: string,
    parentId: string | null = null,
  ) => ({
    id,
    kind,
    title: id,
    parentId,
    sortKey,
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    ...(kind === "file"
      ? { blobRef: { store: "blobs", key: id, size: 1, mime: "text/plain" }, content: null }
      : { content: [] }),
  })
  await idbPut(STORE_NODES, row("note-a", "note", "a0"))
  await idbPut(STORE_NODES, row("child", "note", "a1", "note-a"))
  await idbPut(STORE_NODES, row("file-b", "file", "b0"))
  await idbPut(STORE_NODES, row("note-c", "note", "c0"))

  const first = await listNodeSummaryPage(["note", "file"], { limit: 2, parentId: null })
  assert.deepEqual(
    first.items.map((item) => item.id),
    ["note-a", "file-b"],
  )
  assert.equal(first.items[0]?.hasChildren, true)
  assert.ok(first.nextCursor)

  const second = await listNodeSummaryPage(["note", "file"], {
    limit: 2,
    parentId: null,
    cursor: first.nextCursor,
  })
  assert.deepEqual(
    second.items.map((item) => item.id),
    ["note-c"],
  )
  assert.equal(second.nextCursor, undefined)
  assert.equal(getAllCalls.get(STORE_NODES) ?? 0, 0)
  assert.equal(getAllCalls.get(INDEX_NODES_KIND_SORT_TITLE_ID) ?? 0, 0)
})

test("state compatibility: a v15 row without count is repaired once without an extra revision", async () => {
  await idbPut(STORE_NODES, threadNode("legacy"))
  await idbPut(STORE_AGENT_TASKS, {
    key: "state",
    type: "state",
    revision: 7,
    legacyMigrated: true,
  })
  await idbPut(STORE_AGENT_TASKS, {
    key: "task:legacy",
    type: "task",
    task: task("legacy"),
  })

  const scansBefore = getAllCalls.get(STORE_AGENT_TASKS) ?? 0
  assert.deepEqual(await readThreadTaskIndexHead(), { revision: 7, count: 1 })
  assert.equal(getAllCalls.get(STORE_AGENT_TASKS), scansBefore + 1)
  assert.deepEqual(await idbGet(STORE_AGENT_TASKS, "state"), {
    key: "state",
    type: "state",
    revision: 7,
    count: 1,
    legacyMigrated: true,
  })

  assert.deepEqual(await readThreadTaskIndexHead(), { revision: 7, count: 1 })
  assert.equal(getAllCalls.get(STORE_AGENT_TASKS), scansBefore + 1)
})

test("legacy migration: marker makes import once-only and only live threads survive", async () => {
  await idbPut(STORE_NODES, threadNode("live"))
  await idbPut(STORE_NODES, threadNode("deleted", 100))
  const legacy = [task("live", 30), task("live", 40), task("deleted"), task("missing")]

  const first = await migrateLegacyThreadTasks(legacy)
  assert.equal(first.migrated, true)
  assert.equal(first.imported, 1)
  assert.equal(first.skipped, 3)
  assert.equal(first.revision, 1)
  assert.deepEqual(first.tasks, [task("live", 40)])
  assert.deepEqual(await readThreadTaskIndexHead(), { revision: 1, count: 1 })

  const second = await migrateLegacyThreadTasks([task("deleted"), task("missing")])
  assert.deepEqual(second, {
    revision: 1,
    tasks: [task("live", 40)],
    migrated: false,
    imported: 0,
    skipped: 0,
  })
})

test("create/attach/update: task and thread share one revisioned store", async () => {
  const created = await createTaskThread("workspace-a")
  const node = await idbGet<NodeOfKind<"thread">>(STORE_NODES, created.thread.id)
  assert.equal(created.task.id, created.thread.id)
  assert.equal(created.revision, 1)
  assert.equal(node?.kind, "thread")
  assert.deepEqual(await listThreadTasks(), { revision: 1, tasks: [created.task] })

  const attachedAgain = await attachThreadTask("workspace-b", created.thread.id)
  assert.equal(attachedAgain.revision, 1)
  assert.equal(attachedAgain.task?.workspaceId, "workspace-a")

  const updated = await updateThreadTask(created.thread.id, { status: "running" })
  assert.equal(updated.revision, 2)
  assert.equal(updated.task?.status, "running")
  assert.ok((updated.task?.updatedAt ?? 0) > created.task.updatedAt)

  const noOp = await updateThreadTask(created.thread.id, { status: "running" })
  assert.equal(noOp.revision, 2)
  const touched = await updateThreadTask(created.thread.id, { touch: true })
  assert.equal(touched.revision, 3)
  assert.ok((touched.task?.updatedAt ?? 0) > (updated.task?.updatedAt ?? 0))
})

test("thread tail index: ordinary and task creation seek one key, include tombstones, and ignore other kinds", async () => {
  await idbPut(STORE_NODES, {
    ...threadNode("deleted-tail", 100),
    sortKey: "a5",
  })
  await idbPut(STORE_NODES, {
    id: "note-with-larger-key",
    kind: "note",
    title: "note",
    parentId: null,
    sortKey: "z9",
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    content: [],
  } satisfies NodeOfKind<"note">)

  const ordinary = await createThread()
  const ordinaryNode = await idbGet<NodeOfKind<"thread">>(STORE_NODES, ordinary.id)
  const scoped = await createTaskThread("workspace-a")
  const scopedNode = await idbGet<NodeOfKind<"thread">>(STORE_NODES, scoped.thread.id)

  assert.ok(ordinaryNode)
  assert.ok(scopedNode)
  assert.ok(ordinaryNode.sortKey > "a5")
  assert.ok(scopedNode.sortKey > ordinaryNode.sortKey)
  assert.equal(keyCursorVisits.get(INDEX_NODES_KIND_SORT_KEY), 2)
  assert.equal(keyCursorVisits.get(INDEX_NODES_THREAD_METADATA) ?? 0, 0)
})

test("thread tail transaction: concurrent ordinary and task creation gets unique increasing keys", async () => {
  const [ordinaryA, scopedA, ordinaryB, scopedB] = await Promise.all([
    createThread(),
    createTaskThread("workspace-a"),
    createThread(),
    createTaskThread("workspace-b"),
  ])
  const ids = [ordinaryA.id, scopedA.thread.id, ordinaryB.id, scopedB.thread.id]
  const nodes = await Promise.all(ids.map((id) => idbGet<NodeOfKind<"thread">>(STORE_NODES, id)))
  const keys = nodes.map((node) => node?.sortKey ?? "").sort()

  assert.equal(
    nodes.every((node) => node?.kind === "thread"),
    true,
  )
  assert.equal(new Set(keys).size, 4)
  assert.equal(
    keys.every((key, index) => index === 0 || keys[index - 1]! < key),
    true,
  )
  assert.equal(getAllCalls.get(STORE_NODES) ?? 0, 0)
  assert.deepEqual(await readThreadTaskIndexHead(), { revision: 2, count: 2 })
})

test("kind tail transaction: bookmark, folder, file and feed creation avoids scans and duplicate keys", async () => {
  await idbPut(STORE_NODES, {
    id: "folder-tail",
    kind: "folder",
    title: "folder tail",
    parentId: null,
    sortKey: "a5",
    tags: [],
    createdAt: 1,
    updatedAt: 2,
    deletedAt: 2,
    content: null,
  } satisfies NodeOfKind<"folder">)
  await idbPut(STORE_NODES, {
    id: "folder-a",
    kind: "folder",
    title: "folder a target",
    parentId: null,
    sortKey: "a1",
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    content: null,
  } satisfies NodeOfKind<"folder">)
  await idbPut(STORE_NODES, {
    id: "bookmark-tail",
    kind: "bookmark",
    title: "bookmark tail",
    parentId: null,
    sortKey: "a5",
    tags: [],
    createdAt: 1,
    updatedAt: 2,
    deletedAt: 2,
    content: { url: "https://tail.example", description: "", favicon: "" },
  } satisfies NodeOfKind<"bookmark">)
  await idbPut(STORE_NODES, {
    id: "file-tail",
    kind: "file",
    title: "file tail",
    parentId: null,
    sortKey: "a5",
    tags: [],
    createdAt: 1,
    updatedAt: 2,
    deletedAt: 2,
    blobRef: { store: "blobs", key: "file-tail", size: 0, mime: "text/plain" },
    content: null,
  } satisfies NodeOfKind<"file">)
  await idbPut(STORE_NODES, {
    id: feedNodeId("publisher", "tail.example"),
    kind: "feed",
    title: "feed tail",
    parentId: null,
    sortKey: "a5",
    tags: [],
    createdAt: 1,
    updatedAt: 2,
    deletedAt: 2,
    content: { type: "publisher", key: "tail.example", favicon: "" },
  } satisfies NodeOfKind<"feed">)

  const [folderA, bookmarkA, fileA, feedA, folderB, bookmarkB, fileB, feedB] = await Promise.all([
    addFolder("folder a"),
    addBookmark({ title: "bookmark a", url: "https://a.example", folderId: "folder-a" }),
    addFile(new File(["a"], "a.txt", { type: "text/plain" })),
    addSubscription({ type: "publisher", key: "a.example", title: "feed a" }),
    addFolder("folder b"),
    addBookmark({ title: "bookmark b", url: "https://b.example" }),
    addFile(new File(["b"], "b.txt", { type: "text/plain" })),
    addSubscription({ type: "publisher", key: "b.example", title: "feed b" }),
  ])

  const kindKeys = await Promise.all([
    Promise.all(
      [folderA.id, folderB.id].map(
        async (id) => (await idbGet<NodeOfKind<"folder">>(STORE_NODES, id))?.sortKey,
      ),
    ),
    Promise.all(
      [bookmarkA.id, bookmarkB.id].map(
        async (id) => (await idbGet<NodeOfKind<"bookmark">>(STORE_NODES, id))?.sortKey,
      ),
    ),
    Promise.all(
      [fileA.id, fileB.id].map(
        async (id) => (await idbGet<NodeOfKind<"file">>(STORE_NODES, id))?.sortKey,
      ),
    ),
    Promise.all(
      [feedA, feedB].map(
        async (subscription) =>
          (
            await idbGet<NodeOfKind<"feed">>(
              STORE_NODES,
              feedNodeId(subscription.type, subscription.key),
            )
          )?.sortKey,
      ),
    ),
  ])
  for (const keys of kindKeys) {
    assert.equal(
      keys.every((key) => typeof key === "string" && key > "a5"),
      true,
    )
    assert.equal(new Set(keys).size, 2)
  }
  assert.equal(getAllCalls.get(STORE_NODES) ?? 0, 0)
  assert.equal(keyCursorVisits.get(INDEX_NODES_KIND_SORT_KEY), 8)
  assert.equal(fakeDbs.get(IDB_DATABASE_NAME)?.stores.get(STORE_BLOBS)?.rows.size, 2)
})

test("createNode: every supported kind returns its committed node without a readonly post-read", async () => {
  const created = [
    await createNode({ kind: "note", title: "note" }),
    await createNode({ kind: "folder", title: "folder" }),
    await createNode({
      kind: "bookmark",
      title: "bookmark",
      content: { url: "https://bookmark.example" },
    }),
    await createNode({
      kind: "feed",
      title: "feed",
      content: { type: "publisher", key: "feed.example" },
    }),
    await createNode({ kind: "thread" }),
    await addFileWithNode(new File(["body"], "committed.txt", { type: "text/plain" }), ["local"]),
  ]

  assert.deepEqual(
    created.map((node) => node.kind),
    ["note", "folder", "bookmark", "feed", "thread", "file"],
  )
  assert.equal(
    created.every((node) => node.id && node.sortKey && node.updatedAt === node.createdAt),
    true,
  )
  assert.equal((objectStoreGetModes.get(STORE_NODES) ?? []).includes("readonly"), false)
})

test("note default create: concurrent roots and children use the kind tail without cloning note bodies", async () => {
  await idbPut(STORE_NODES, {
    id: "parent-a",
    kind: "note",
    title: "parent",
    parentId: null,
    sortKey: "a1",
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    content: [],
  } satisfies NodeOfKind<"note">)
  await idbPut(STORE_NODES, {
    id: "note-tail",
    kind: "note",
    title: "deleted note tail",
    parentId: "another-parent",
    sortKey: "a5",
    tags: [],
    createdAt: 1,
    updatedAt: 2,
    deletedAt: 2,
    content: [{ type: "p", children: [{ text: "large body sentinel" }] }],
  } satisfies NodeOfKind<"note">)

  const notes = await Promise.all([
    addNote({ title: "root a" }),
    addNote({ title: "child", parentId: "parent-a" }),
    addNote({ title: "root b" }),
  ])
  const keys = notes.map((note) => note.sortKey)

  assert.equal(
    keys.every((key) => key > "a5"),
    true,
  )
  assert.equal(new Set(keys).size, 3)
  assert.equal(getAllCalls.get(INDEX_NODES_KIND) ?? 0, 0)
  assert.equal(keyCursorVisits.get(INDEX_NODES_KIND_SORT_KEY), 3)
})

test("note default create: a corrupted global tail fails closed instead of inserting at the front", async () => {
  await idbPut(STORE_NODES, {
    id: "target-parent",
    kind: "note",
    title: "target parent",
    parentId: null,
    sortKey: "a0",
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    content: [],
  } satisfies NodeOfKind<"note">)
  await idbPut(STORE_NODES, {
    id: "note-valid",
    kind: "note",
    title: "valid sibling",
    parentId: "target-parent",
    sortKey: "a5",
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    content: [],
  } satisfies NodeOfKind<"note">)
  await idbPut(STORE_NODES, {
    id: "note-corrupted-tail",
    kind: "note",
    title: "corrupted other branch",
    parentId: "other-parent",
    sortKey: "invalid",
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    content: [],
  } satisfies NodeOfKind<"note">)

  await assert.rejects(
    () => addNote({ title: "must not move to front", parentId: "target-parent" }),
    /非法排序键/,
  )
  assert.equal(fakeDbs.get(IDB_DATABASE_NAME)?.stores.get(STORE_NODES)?.rows.size, 3)
})

test("note explicit insert: sibling snapshot and add stay in one write transaction", async () => {
  const first = await addNote({ title: "first" })
  const second = await addNote({ title: "second" })
  const inserted = await addNote({ title: "inserted", afterSortKey: first.sortKey })

  assert.ok(inserted.sortKey > first.sortKey)
  assert.ok(inserted.sortKey < second.sortKey)
  assert.equal(getAllCalls.get(INDEX_NODES_KIND), 1)
})

test("note move: concurrent opposite moves cannot commit a parent cycle", async () => {
  await idbPut(STORE_NODES, storedNote("note-a", null, "a0"))
  await idbPut(STORE_NODES, storedNote("note-b", null, "a1"))

  const results = await Promise.allSettled([
    moveNote("note-a", "note-b"),
    moveNote("note-b", "note-a"),
  ])
  const noteA = await idbGet<NodeOfKind<"note">>(STORE_NODES, "note-a")
  const noteB = await idbGet<NodeOfKind<"note">>(STORE_NODES, "note-b")
  const rejected = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  )

  assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1)
  assert.equal(results.filter(({ status }) => status === "rejected").length, 1)
  assert.match(String(rejected?.reason), /不能把页面移动到它自己的子页面下/)
  assert.equal(
    indexGetAllModes.get(INDEX_NODES_KIND)?.every((mode) => mode === "readwrite"),
    true,
  )
  assert.equal(noteA?.parentId === "note-b" && noteB?.parentId === "note-a", false)
  assert.equal(
    (noteA?.parentId === "note-b" && noteB?.parentId === null) ||
      (noteB?.parentId === "note-a" && noteA?.parentId === null),
    true,
  )
})

test("note move: concurrent inserts after one anchor receive distinct keys inside the same gap", async () => {
  await idbPut(STORE_NODES, storedNote("parent", null, "a5"))
  await idbPut(STORE_NODES, storedNote("anchor", "parent", "a0"))
  await idbPut(STORE_NODES, storedNote("successor", "parent", "a2"))
  await idbPut(STORE_NODES, storedNote("moving-a", null, "a3"))
  await idbPut(STORE_NODES, storedNote("moving-b", null, "a4"))

  await Promise.all([
    moveNote("moving-a", "parent", { afterSortKey: "a0" }),
    moveNote("moving-b", "parent", { afterSortKey: "a0" }),
  ])
  const moved = await Promise.all(
    ["moving-a", "moving-b"].map((id) => idbGet<NodeOfKind<"note">>(STORE_NODES, id)),
  )
  const keys = moved.map((note) => note?.sortKey)

  assert.equal(
    moved.every((note) => note?.parentId === "parent"),
    true,
  )
  assert.equal(
    keys.every((key) => typeof key === "string" && key > "a0" && key < "a2"),
    true,
  )
  assert.equal(new Set(keys).size, 2)
})

test("bookmark tree move: bookmark and folder share an atomic cross-kind root ordering", async () => {
  await idbPut(STORE_NODES, storedBookmark("root-anchor", null, "a0"))
  await idbPut(STORE_NODES, storedFolder("root-successor", "a2"))
  await idbPut(STORE_NODES, storedFolder("container", "a3"))
  await idbPut(STORE_NODES, storedFolder("moving-folder", "a4"))
  await idbPut(STORE_NODES, storedBookmark("moving-bookmark", "container", "a5"))

  await Promise.all([
    moveBookmark("moving-bookmark", null, { afterSortKey: "a0" }),
    moveFolder("moving-folder", { afterSortKey: "a0" }),
  ])
  const bookmark = await idbGet<NodeOfKind<"bookmark">>(STORE_NODES, "moving-bookmark")
  const folder = await idbGet<NodeOfKind<"folder">>(STORE_NODES, "moving-folder")

  assert.equal(bookmark?.parentId, null)
  assert.equal(folder?.parentId, null)
  assert.ok(bookmark && bookmark.sortKey > "a0" && bookmark.sortKey < "a2")
  assert.ok(folder && folder.sortKey > "a0" && folder.sortKey < "a2")
  assert.notEqual(bookmark?.sortKey, folder?.sortKey)
  assert.equal(
    indexGetAllModes.get(INDEX_NODES_KIND)?.every((mode) => mode === "readwrite"),
    true,
  )
})

test("folder delete: concurrent move either lands before migration or rejects the deleted target", async () => {
  await idbPut(STORE_NODES, storedBookmark("root-anchor", null, "a0"))
  await idbPut(STORE_NODES, storedFolder("folder", "a1"))
  await idbPut(STORE_NODES, storedBookmark("inside", "folder", "a0"))
  await idbPut(STORE_NODES, storedBookmark("racing", null, "a2"))

  const results = await Promise.allSettled([
    moveBookmark("racing", "folder"),
    deleteFolder("folder"),
  ])
  const folder = await idbGet<NodeOfKind<"folder">>(STORE_NODES, "folder")
  const bookmarks = await Promise.all(
    ["inside", "racing"].map((id) => idbGet<NodeOfKind<"bookmark">>(STORE_NODES, id)),
  )
  const snapshot = await idbGet(STORE_TRASH_SNAPSHOTS, "folder")

  assert.equal(results[1]?.status, "fulfilled")
  if (results[0]?.status === "rejected") {
    assert.match(String(results[0].reason), /目标收藏夹不存在/)
  } else {
    assert.ok(bookmarks[1] && bookmarks[1].updatedAt > 2)
  }
  assert.ok(folder?.deletedAt)
  assert.equal(
    bookmarks.every((bookmark) => bookmark?.parentId !== "folder"),
    true,
  )
  assert.equal(new Set(bookmarks.map((bookmark) => bookmark?.sortKey)).size, bookmarks.length)
  assert.ok(snapshot)
})

test("folder delete: a commit-time abort rolls back child migration, snapshot and tombstone", async () => {
  const folder = storedFolder("folder", "a1")
  const child = storedBookmark("inside", "folder", "a0")
  await idbPut(STORE_NODES, folder)
  await idbPut(STORE_NODES, child)
  abortNextReadwriteCommit = true

  await assert.rejects(() => deleteFolder("folder"), /injected readwrite commit abort/)

  assert.deepEqual(await idbGet(STORE_NODES, "folder"), folder)
  assert.deepEqual(await idbGet(STORE_NODES, "inside"), child)
  assert.equal(await idbGet(STORE_TRASH_SNAPSHOTS, "folder"), undefined)
})

test("note delete: move/delete races never leave a live child under a tombstone", async () => {
  await idbPut(STORE_NODES, storedNote("delete-first-parent", null, "a0"))
  await idbPut(STORE_NODES, storedNote("delete-first-child", null, "a1"))

  const deleteFirst = await Promise.allSettled([
    deleteNote("delete-first-parent"),
    moveNote("delete-first-child", "delete-first-parent"),
  ])
  const deletedParent = await idbGet<NodeOfKind<"note">>(STORE_NODES, "delete-first-parent")
  const rejectedChild = await idbGet<NodeOfKind<"note">>(STORE_NODES, "delete-first-child")

  assert.equal(deleteFirst[0]?.status, "fulfilled")
  assert.equal(deleteFirst[1]?.status, "rejected")
  if (deleteFirst[1]?.status === "rejected") {
    assert.match(String(deleteFirst[1].reason), /目标父页面不存在或已删除/)
  }
  assert.ok(deletedParent?.deletedAt)
  assert.equal(rejectedChild?.parentId, null)
  assert.equal(rejectedChild?.deletedAt, undefined)

  await idbPut(STORE_NODES, storedNote("move-first-parent", null, "a2"))
  await idbPut(STORE_NODES, storedNote("move-first-child", null, "a3"))
  const moveFirst = await Promise.allSettled([
    moveNote("move-first-child", "move-first-parent"),
    deleteNote("move-first-parent"),
  ])
  const capturedChild = await idbGet<NodeOfKind<"note">>(STORE_NODES, "move-first-child")

  assert.equal(
    moveFirst.every(({ status }) => status === "fulfilled"),
    true,
  )
  assert.ok(capturedChild?.deletedAt)
  assert.ok(await idbGet(STORE_TRASH_SNAPSHOTS, "move-first-child"))
})

test("note delete: a commit-time abort restores every subtree row and snapshot", async () => {
  const parent = storedNote("parent", null, "a0")
  const child = storedNote("child", "parent", "a1")
  await idbPut(STORE_NODES, parent)
  await idbPut(STORE_NODES, child)
  abortNextReadwriteCommit = true

  await assert.rejects(() => deleteNote(parent.id), /injected readwrite commit abort/)

  assert.deepEqual(await idbGet(STORE_NODES, parent.id), parent)
  assert.deepEqual(await idbGet(STORE_NODES, child.id), child)
  assert.equal(await idbGet(STORE_TRASH_SNAPSHOTS, parent.id), undefined)
  assert.equal(await idbGet(STORE_TRASH_SNAPSHOTS, child.id), undefined)
})

test("note subtree delete and undo broadcast kind-level invalidation for descendants", async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window")
  const target = new EventTarget()
  const updates: FilesUpdate[] = []
  target.addEventListener(FILES_UPDATED, (event) => {
    updates.push((event as CustomEvent<FilesUpdate>).detail)
  })
  Object.defineProperty(globalThis, "window", { value: target, configurable: true })

  try {
    const parent = storedNote("notify-parent", null, "a0")
    const child = storedNote("notify-child", parent.id, "a1")
    await idbPut(STORE_NODES, parent)
    await idbPut(STORE_NODES, child)

    const captured = await deleteNote(parent.id)
    assert.deepEqual(updates, [{ kind: "note" }])

    await restoreSubtree(captured)
    assert.deepEqual(updates, [{ kind: "note" }, { kind: "note" }])
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow)
    else Reflect.deleteProperty(globalThis, "window")
  }
})

test("bookmark delete: snapshot and tombstone roll back together at commit", async () => {
  const bookmark = storedBookmark("bookmark", null, "a0")
  await idbPut(STORE_NODES, bookmark)
  abortNextReadwriteCommit = true

  await assert.rejects(() => deleteBookmark(bookmark.id), /injected readwrite commit abort/)

  assert.deepEqual(await idbGet(STORE_NODES, bookmark.id), bookmark)
  assert.equal(await idbGet(STORE_TRASH_SNAPSHOTS, bookmark.id), undefined)
})

test("node write: note position and fields commit atomically", async () => {
  await idbPut(STORE_NODES, storedNote("old-parent", null, "a0"))
  await idbPut(STORE_NODES, storedNote("new-parent", null, "a1"))
  const child = storedNote("child", "old-parent", "a2")
  await idbPut(STORE_NODES, child)
  abortNextReadwriteCommit = true

  await assert.rejects(
    () => updateNode("note", child.id, { parentId: "new-parent", title: "renamed" }),
    /injected readwrite commit abort/,
  )
  assert.deepEqual(await idbGet(STORE_NODES, child.id), child)

  await updateNode("note", child.id, { parentId: "new-parent", title: "renamed" })
  const updated = await idbGet<NodeOfKind<"note">>(STORE_NODES, child.id)
  assert.equal(updated?.parentId, "new-parent")
  assert.equal(updated?.title, "renamed")
})

test("node write: bookmark fields and folder change share one transaction without same-folder reorder", async () => {
  await idbPut(STORE_NODES, storedFolder("old-folder", "a2"))
  await idbPut(STORE_NODES, storedFolder("new-folder", "a3"))
  const bookmark = storedBookmark("bookmark", "old-folder", "a0")
  await idbPut(STORE_NODES, bookmark)
  await idbPut(STORE_NODES, storedBookmark("sibling", "old-folder", "a1"))

  await updateNode("bookmark", bookmark.id, {
    parentId: "old-folder",
    title: "same folder",
  })
  const sameFolder = await idbGet<NodeOfKind<"bookmark">>(STORE_NODES, bookmark.id)
  assert.equal(sameFolder?.sortKey, bookmark.sortKey)
  assert.equal(sameFolder?.title, "same folder")

  abortNextReadwriteCommit = true
  await assert.rejects(
    () =>
      updateNode("bookmark", bookmark.id, {
        parentId: "new-folder",
        title: "must roll back",
      }),
    /injected readwrite commit abort/,
  )
  assert.deepEqual(await idbGet(STORE_NODES, bookmark.id), sameFolder)
})

test("trash restore: a late snapshot delete failure rolls back generic node revival", async () => {
  const full = threadNode("restore-node-rollback")
  const tombstone = {
    ...full,
    content: { messages: [] },
    deletedAt: 50,
    updatedAt: 50,
  }
  const snapshot = { id: full.id, node: full, capturedAt: 50 }
  await idbPut(STORE_NODES, tombstone)
  await idbPut(STORE_TRASH_SNAPSHOTS, snapshot)
  failNextWriteStore = STORE_TRASH_SNAPSHOTS

  await assert.rejects(() => restoreTrashItem(full.id), /injected trash_snapshots write failure/)

  assert.deepEqual(await idbGet(STORE_NODES, full.id), tombstone)
  assert.deepEqual(await idbGet(STORE_TRASH_SNAPSHOTS, full.id), snapshot)
})

test("trash restore: file Blob, node and snapshot roll back together on a late failure", async () => {
  const full = storedFile("restore-file-rollback")
  const tombstone = { ...full, deletedAt: 60, updatedAt: 60 }
  const snapshotBlob = new Blob(["body"], { type: "text/plain" })
  const snapshot = { id: full.id, node: full, blob: snapshotBlob, capturedAt: 60 }
  await idbPut(STORE_NODES, tombstone)
  await idbPut(STORE_TRASH_SNAPSHOTS, snapshot)
  failNextWriteStore = STORE_TRASH_SNAPSHOTS

  await assert.rejects(() => restoreTrashItem(full.id), /injected trash_snapshots write failure/)

  assert.deepEqual(await idbGet(STORE_NODES, full.id), tombstone)
  assert.equal(await idbGet(STORE_BLOBS, full.id), undefined)
  const kept = await idbGet<{ node: Node; blob: Blob }>(STORE_TRASH_SNAPSHOTS, full.id)
  assert.deepEqual(kept?.node, full)
  assert.equal(await kept?.blob.text(), "body")
})

test("trash restore/purge: overlapping operations serialize without stale resurrection", async () => {
  const seed = async (id: string) => {
    const full = storedFile(id)
    const tombstone = { ...full, deletedAt: 70, updatedAt: 70 }
    await idbPut(STORE_NODES, tombstone)
    await idbPut(STORE_TRASH_SNAPSHOTS, {
      id,
      node: full,
      blob: new Blob([id], { type: "text/plain" }),
      capturedAt: 70,
    })
    return { full, tombstone }
  }

  const restoreFirst = await seed("restore-first")
  await Promise.all([restoreTrashItem(restoreFirst.full.id), purgeTrashItem(restoreFirst.full.id)])
  const restored = await idbGet<NodeOfKind<"file">>(STORE_NODES, restoreFirst.full.id)
  assert.equal(restored?.deletedAt, undefined)
  assert.equal(
    await (await idbGet<{ blob: Blob }>(STORE_BLOBS, restoreFirst.full.id))?.blob.text(),
    restoreFirst.full.id,
  )
  assert.equal(await idbGet(STORE_TRASH_SNAPSHOTS, restoreFirst.full.id), undefined)

  const purgeFirst = await seed("purge-first")
  await Promise.all([purgeTrashItem(purgeFirst.full.id), restoreTrashItem(purgeFirst.full.id)])
  assert.equal(await idbGet(STORE_NODES, purgeFirst.full.id), undefined)
  assert.equal(await idbGet(STORE_BLOBS, purgeFirst.full.id), undefined)
  assert.equal(await idbGet(STORE_TRASH_SNAPSHOTS, purgeFirst.full.id), undefined)
})

test("trash restore/purge: a stale expected revision cannot touch a newer file tombstone", async () => {
  const id = "trash-newer-revision"
  const oldTombstone = { ...storedFile(id), deletedAt: 100, updatedAt: 100 }
  await idbPut(STORE_NODES, oldTombstone)
  const oldExpected = {
    kind: "file" as const,
    updatedAt: oldTombstone.updatedAt,
    deletedAt: oldTombstone.deletedAt,
  }

  const newerLive = {
    ...storedFile(id),
    title: "newer.txt",
    updatedAt: 199,
  }
  const newerTombstone = { ...newerLive, deletedAt: 200, updatedAt: 200 }
  const newerSnapshotBlob = new Blob(["newer snapshot"], { type: "text/plain" })
  const newerStoredBlob = new Blob(["newer stored blob"], { type: "text/plain" })
  const newerSnapshot = {
    id,
    node: newerLive,
    blob: newerSnapshotBlob,
    capturedAt: 200,
  }
  await idbPut(STORE_NODES, newerTombstone)
  await idbPut(STORE_TRASH_SNAPSHOTS, newerSnapshot)
  await idbPut(STORE_BLOBS, { key: id, blob: newerStoredBlob })

  assert.equal(await restoreTrashItem(id, oldExpected), false)
  assert.equal(await purgeTrashItem(id, oldExpected), false)

  assert.deepEqual(await idbGet(STORE_NODES, id), newerTombstone)
  const keptSnapshot = await idbGet<{ node: NodeOfKind<"file">; blob: Blob }>(
    STORE_TRASH_SNAPSHOTS,
    id,
  )
  assert.deepEqual(keptSnapshot?.node, newerLive)
  assert.equal(await keptSnapshot?.blob.text(), "newer snapshot")
  assert.equal(
    await (await idbGet<{ blob: Blob }>(STORE_BLOBS, id))?.blob.text(),
    "newer stored blob",
  )
})

test("note subtree restore: nodes and snapshots roll back together, then restore together", async () => {
  const parent = {
    ...storedNote("restore-subtree-parent", null, "a0"),
    content: [{ type: "p", children: [{ text: "parent body" }] }],
  } satisfies NodeOfKind<"note">
  const child = {
    ...storedNote("restore-subtree-child", parent.id, "a1"),
    content: [{ type: "p", children: [{ text: "child body" }] }],
  } satisfies NodeOfKind<"note">
  await idbPut(STORE_NODES, parent)
  await idbPut(STORE_NODES, child)
  await deleteNote(parent.id)

  const parentTombstone = await idbGet<NodeOfKind<"note">>(STORE_NODES, parent.id)
  const childTombstone = await idbGet<NodeOfKind<"note">>(STORE_NODES, child.id)
  const parentSnapshot = await idbGet(STORE_TRASH_SNAPSHOTS, parent.id)
  const childSnapshot = await idbGet(STORE_TRASH_SNAPSHOTS, child.id)
  assert.ok(parentTombstone?.deletedAt != null)
  assert.ok(childTombstone?.deletedAt != null)
  assert.ok(parentSnapshot)
  assert.ok(childSnapshot)
  const expected = {
    kind: "note" as const,
    updatedAt: parentTombstone.updatedAt,
    deletedAt: parentTombstone.deletedAt,
  }

  failNextWriteStore = STORE_TRASH_SNAPSHOTS
  await assert.rejects(
    () => restoreNoteTrashSubtree(parent.id, expected),
    /injected trash_snapshots write failure/,
  )

  assert.deepEqual(await idbGet(STORE_NODES, parent.id), parentTombstone)
  assert.deepEqual(await idbGet(STORE_NODES, child.id), childTombstone)
  assert.deepEqual(await idbGet(STORE_TRASH_SNAPSHOTS, parent.id), parentSnapshot)
  assert.deepEqual(await idbGet(STORE_TRASH_SNAPSHOTS, child.id), childSnapshot)

  assert.equal(await restoreNoteTrashSubtree(parent.id, expected), true)
  const restoredParent = await idbGet<NodeOfKind<"note">>(STORE_NODES, parent.id)
  const restoredChild = await idbGet<NodeOfKind<"note">>(STORE_NODES, child.id)
  assert.equal(restoredParent?.deletedAt, undefined)
  assert.equal(restoredChild?.deletedAt, undefined)
  assert.equal(restoredParent?.parentId, null)
  assert.equal(restoredChild?.parentId, parent.id)
  assert.deepEqual(restoredParent?.content, parent.content)
  assert.deepEqual(restoredChild?.content, child.content)
  assert.ok((restoredParent?.updatedAt ?? 0) > parentTombstone.updatedAt)
  assert.ok((restoredChild?.updatedAt ?? 0) > childTombstone.updatedAt)
  assert.equal(await idbGet(STORE_TRASH_SNAPSHOTS, parent.id), undefined)
  assert.equal(await idbGet(STORE_TRASH_SNAPSHOTS, child.id), undefined)
})

test("note subtree restore/delete: concurrent operations never leave a tombstoned parent with a live child", async () => {
  const seedDeletedSubtree = async (prefix: string) => {
    const parent = {
      ...storedNote(`${prefix}-parent`, null, "a0"),
      content: [{ type: "p", children: [{ text: `${prefix} parent` }] }],
    } satisfies NodeOfKind<"note">
    const child = {
      ...storedNote(`${prefix}-child`, parent.id, "a1"),
      content: [{ type: "p", children: [{ text: `${prefix} child` }] }],
    } satisfies NodeOfKind<"note">
    await idbPut(STORE_NODES, parent)
    await idbPut(STORE_NODES, child)
    await deleteNote(parent.id)
    const tombstone = await idbGet<NodeOfKind<"note">>(STORE_NODES, parent.id)
    assert.ok(tombstone?.deletedAt != null)
    return {
      parent,
      child,
      expected: {
        kind: "note" as const,
        updatedAt: tombstone.updatedAt,
        deletedAt: tombstone.deletedAt,
      },
    }
  }
  const assertConsistent = async (parentId: string, childId: string) => {
    const parent = await idbGet<NodeOfKind<"note">>(STORE_NODES, parentId)
    const child = await idbGet<NodeOfKind<"note">>(STORE_NODES, childId)
    assert.ok(parent)
    assert.ok(child)
    assert.equal(parent.deletedAt == null, child.deletedAt == null)
  }

  const restoreFirst = await seedDeletedSubtree("restore-first-subtree")
  await Promise.all([
    restoreNoteTrashSubtree(restoreFirst.parent.id, restoreFirst.expected),
    deleteNote(restoreFirst.parent.id),
  ])
  await assertConsistent(restoreFirst.parent.id, restoreFirst.child.id)

  const deleteFirst = await seedDeletedSubtree("delete-first-subtree")
  await Promise.all([
    deleteNote(deleteFirst.parent.id),
    restoreNoteTrashSubtree(deleteFirst.parent.id, deleteFirst.expected),
  ])
  await assertConsistent(deleteFirst.parent.id, deleteFirst.child.id)
})

test("trash restore: invalid snapshots cannot change identity and note parent cycles fall back to root", async () => {
  const thread = { ...threadNode("snapshot-mismatch"), deletedAt: 80, updatedAt: 80 }
  await idbPut(STORE_NODES, thread)
  await idbPut(STORE_TRASH_SNAPSHOTS, {
    id: thread.id,
    node: storedNote("different-id", null, "a0"),
    capturedAt: 80,
  })
  await restoreTrashItem(thread.id)
  const restoredThread = await idbGet<NodeOfKind<"thread">>(STORE_NODES, thread.id)
  assert.equal(restoredThread?.kind, "thread")
  assert.equal(restoredThread?.deletedAt, undefined)
  assert.equal(await idbGet(STORE_NODES, "different-id"), undefined)

  const child = storedNote("restore-cycle-child", "restore-cycle-parent", "a1")
  const tombstone = { ...child, deletedAt: 90, updatedAt: 90 }
  await idbPut(STORE_NODES, tombstone)
  await idbPut(STORE_NODES, storedNote("restore-cycle-parent", child.id, "a0"))
  await idbPut(STORE_TRASH_SNAPSHOTS, { id: child.id, node: child, capturedAt: 90 })
  await restoreTrashItem(child.id)
  assert.equal((await idbGet<NodeOfKind<"note">>(STORE_NODES, child.id))?.parentId, null)
})

test("empty trash: a late related-store failure rolls back the entire batch", async () => {
  const note = storedNote("empty-note", null, "a0", 100)
  const file = storedFile("empty-file", 101)
  const fileBlob = new Blob(["file"], { type: "text/plain" })
  await idbPut(STORE_NODES, note)
  await idbPut(STORE_NODES, file)
  await idbPut(STORE_BLOBS, { key: file.id, blob: fileBlob })
  await idbPut(STORE_TRASH_SNAPSHOTS, { id: note.id, node: note, capturedAt: 100 })
  await idbPut(STORE_TRASH_SNAPSHOTS, {
    id: file.id,
    node: file,
    blob: fileBlob,
    capturedAt: 101,
  })
  failNextWriteStore = STORE_TRASH_SNAPSHOTS

  await assert.rejects(() => emptyTrash(), /injected trash_snapshots write failure/)
  assert.deepEqual(await idbGet(STORE_NODES, note.id), note)
  assert.deepEqual(await idbGet(STORE_NODES, file.id), file)
  assert.equal(await (await idbGet<{ blob: Blob }>(STORE_BLOBS, file.id))?.blob.text(), "file")
  assert.ok(await idbGet(STORE_TRASH_SNAPSHOTS, note.id))
  assert.ok(await idbGet(STORE_TRASH_SNAPSHOTS, file.id))

  assert.equal(await emptyTrash(), 2)
  for (const id of [note.id, file.id]) {
    assert.equal(await idbGet(STORE_NODES, id), undefined)
    assert.equal(await idbGet(STORE_TRASH_SNAPSHOTS, id), undefined)
  }
  assert.equal(await idbGet(STORE_BLOBS, file.id), undefined)
})

test("purge trash: a related snapshot failure rolls back node and Blob deletion", async () => {
  const file = storedFile("purge-rollback", 110)
  const blob = new Blob(["keep"], { type: "text/plain" })
  const snapshot = { id: file.id, node: file, blob, capturedAt: 110 }
  await idbPut(STORE_NODES, file)
  await idbPut(STORE_BLOBS, { key: file.id, blob })
  await idbPut(STORE_TRASH_SNAPSHOTS, snapshot)
  failNextWriteStore = STORE_TRASH_SNAPSHOTS

  await assert.rejects(() => purgeTrashItem(file.id), /injected trash_snapshots write failure/)
  assert.deepEqual(await idbGet(STORE_NODES, file.id), file)
  assert.equal(await (await idbGet<{ blob: Blob }>(STORE_BLOBS, file.id))?.blob.text(), "keep")
  assert.ok(await idbGet(STORE_TRASH_SNAPSHOTS, file.id))
})

test("bookmark restore: a missing or deleted folder is downgraded to the root atomically", async () => {
  const original = storedBookmark("bookmark", "deleted-folder", "a1")
  const missingParent = storedBookmark("missing-parent", "missing-folder", "a2")
  const tombstone = { ...original, deletedAt: 10, updatedAt: 10 }
  const missingParentTombstone = { ...missingParent, deletedAt: 11, updatedAt: 11 }
  await idbPut(STORE_NODES, storedFolder("deleted-folder", "a0", 9))
  await idbPut(STORE_NODES, tombstone)
  await idbPut(STORE_NODES, missingParentTombstone)
  await idbPut(STORE_TRASH_SNAPSHOTS, {
    id: original.id,
    node: original,
    capturedAt: 10,
  })
  await idbPut(STORE_TRASH_SNAPSHOTS, {
    id: missingParent.id,
    node: missingParent,
    capturedAt: 11,
  })

  await restoreTrashItem(original.id)
  await restoreTrashItem(missingParent.id)
  const restored = await idbGet<NodeOfKind<"bookmark">>(STORE_NODES, original.id)
  const restoredMissing = await idbGet<NodeOfKind<"bookmark">>(STORE_NODES, missingParent.id)

  assert.equal(restored?.parentId, null)
  assert.equal(restoredMissing?.parentId, null)
  assert.equal(restored?.deletedAt, undefined)
  assert.equal(restoredMissing?.deletedAt, undefined)
  assert.equal(await idbGet(STORE_TRASH_SNAPSHOTS, original.id), undefined)
  assert.equal(await idbGet(STORE_TRASH_SNAPSHOTS, missingParent.id), undefined)
})

test("tree parent validation: missing and deleted targets never create dangling children", async () => {
  const deletedFolder = storedFolder("deleted-folder", "a0", 5)
  const deletedNote = storedNote("deleted-note", null, "a0", 5)
  await idbPut(STORE_NODES, deletedFolder)
  await idbPut(STORE_NODES, deletedNote)

  await assert.rejects(
    () => addBookmark({ title: "invalid", url: "https://invalid.example", folderId: "missing" }),
    /目标收藏夹不存在/,
  )
  await assert.rejects(
    () =>
      addBookmark({
        title: "deleted",
        url: "https://deleted.example",
        folderId: "deleted-folder",
      }),
    /目标收藏夹不存在/,
  )
  await assert.rejects(
    () => addNote({ title: "invalid", parentId: "deleted-note" }),
    /目标父页面不存在或已删除/,
  )
  assert.equal(await updateNode("note", deletedNote.id, { title: "must stay deleted" }), undefined)
  assert.deepEqual(await idbGet(STORE_NODES, deletedNote.id), deletedNote)
  await assert.rejects(
    () => updateNode("folder", deletedFolder.id, { parentId: deletedNote.id }),
    /收藏夹不能嵌套/,
  )
  assert.equal(
    [...(fakeDbs.get(IDB_DATABASE_NAME)?.stores.get(STORE_NODES)?.rows.values() ?? [])].filter(
      (value) => {
        const kind = (value as { kind?: string }).kind
        return (
          kind === "bookmark" ||
          (kind === "note" && (value as { id?: string }).id !== "deleted-note")
        )
      },
    ).length,
    0,
  )
})

test("feed create: concurrent requests for the same deterministic id stay idempotent", async () => {
  const input = { type: "publisher" as const, key: "same.example", title: "same" }
  const values = await Promise.all([
    addSubscription(input),
    addSubscription(input),
    addSubscription(input),
  ])

  assert.equal(new Set(values.map((value) => value.id)).size, 1)
  assert.equal(new Set(values.map((value) => value.createdAt)).size, 1)
  assert.equal(keyCursorCalls.get(INDEX_NODES_KIND_SORT_KEY), 1)
  assert.equal(
    [...(fakeDbs.get(IDB_DATABASE_NAME)?.stores.get(STORE_NODES)?.rows.values() ?? [])].filter(
      (value) => (value as { kind?: string }).kind === "feed",
    ).length,
    1,
  )
})

test("feed sync: snapshot, sort-key allocation and writes share the transaction with local creates", async () => {
  await idbPut(STORE_NODES, {
    id: feedNodeId("publisher", "tail.example"),
    kind: "feed",
    title: "feed tail",
    parentId: null,
    sortKey: "a5",
    tags: [],
    createdAt: 1,
    updatedAt: 2,
    deletedAt: 2,
    content: { type: "publisher", key: "tail.example", favicon: "" },
  } satisfies NodeOfKind<"feed">)
  const synced = [
    {
      id: "publisher:sync-a.example",
      type: "publisher" as const,
      key: "sync-a.example",
      title: "sync a",
      favicon: "",
      createdAt: 10,
      updatedAt: 10,
    },
    {
      id: "publisher:sync-b.example",
      type: "publisher" as const,
      key: "sync-b.example",
      title: "sync b",
      favicon: "",
      createdAt: 11,
      updatedAt: 11,
    },
  ]
  const expectedLocal = await listAllSubscriptions()
  getAllCalls.clear()
  indexGetAllModes.clear()
  const [, local] = await Promise.all([
    bulkPutSubscriptions(synced, expectedLocal),
    addSubscription({ type: "publisher", key: "local.example", title: "local" }),
  ])
  const ids = [
    ...synced.map((subscription) => feedNodeId(subscription.type, subscription.key)),
    feedNodeId(local.type, local.key),
  ]
  const keys = await Promise.all(
    ids.map(async (id) => (await idbGet<NodeOfKind<"feed">>(STORE_NODES, id))?.sortKey),
  )

  assert.equal(
    keys.every((key) => typeof key === "string" && key > "a5"),
    true,
  )
  assert.equal(new Set(keys).size, 3)
  assert.equal(getAllCalls.get(INDEX_NODES_KIND), 1)
  assert.deepEqual(indexGetAllModes.get(INDEX_NODES_KIND), ["readwrite"])
})

test("feed sync: a new deterministic id cannot overwrite a non-feed node", async () => {
  const collisionId = feedNodeId("publisher", "collision.example")
  const occupied = {
    id: collisionId,
    kind: "note",
    title: "must survive",
    parentId: null,
    sortKey: "a0",
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    content: [],
  } satisfies NodeOfKind<"note">
  await idbPut(STORE_NODES, occupied)
  const expectedLocal = await listAllSubscriptions()

  await assert.rejects(
    () =>
      bulkPutSubscriptions(
        [
          {
            id: "publisher:safe.example",
            type: "publisher",
            key: "safe.example",
            title: "safe",
            favicon: "",
            createdAt: 2,
            updatedAt: 2,
          },
          {
            id: "publisher:collision.example",
            type: "publisher",
            key: "collision.example",
            title: "collision",
            favicon: "",
            createdAt: 2,
            updatedAt: 2,
          },
        ],
        expectedLocal,
      ),
    /duplicate key/,
  )

  assert.deepEqual(await idbGet(STORE_NODES, collisionId), occupied)
  assert.equal(await idbGet(STORE_NODES, feedNodeId("publisher", "safe.example")), undefined)
})

test("note sync: a remote note id cannot overwrite another node kind", async () => {
  const occupied = {
    id: "cross-kind-collision",
    kind: "folder",
    title: "must survive",
    parentId: null,
    sortKey: "a0",
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    content: null,
  } satisfies NodeOfKind<"folder">
  await idbPut(STORE_NODES, occupied)
  const expectedLocal = await listAllNotes()
  const safeRow = storedNote("remote-safe", null, "a1")
  const collisionRow = storedNote(occupied.id, null, "a2")
  const { kind: _safeKind, ...safe } = safeRow
  const { kind: _collisionKind, ...collision } = collisionRow

  await assert.rejects(() => bulkPutNotes([safe, collision], expectedLocal), /duplicate key/)

  assert.deepEqual(await idbGet(STORE_NODES, occupied.id), occupied)
  assert.equal(await idbGet(STORE_NODES, safe.id), undefined)
})

test("bookmark sync: folder and bookmark commit atomically and reject a stale local snapshot", async () => {
  const incoming: BookmarkSyncNode[] = [
    {
      id: "sync-folder",
      kind: "folder",
      title: "sync folder",
      parentId: null,
      sortKey: "a0",
      tags: [],
      createdAt: 1,
      updatedAt: 1,
      content: null,
    },
    {
      id: "sync-bookmark",
      kind: "bookmark",
      title: "sync bookmark",
      parentId: "sync-folder",
      sortKey: "a0",
      tags: [],
      createdAt: 1,
      updatedAt: 1,
      content: { url: "https://sync.example", description: "", favicon: "" },
    },
  ]
  const committed = await bulkPutBookmarkNodes(incoming, [])
  assert.deepEqual(committed, incoming)
  assert.deepEqual(await listAllBookmarkNodes(), incoming)

  await updateNode("bookmark", "sync-bookmark", { title: "local edit" })
  const locallyEdited = await idbGet<NodeOfKind<"bookmark">>(STORE_NODES, "sync-bookmark")
  assert.ok(locallyEdited)
  const remoteOnly: BookmarkSyncNode = {
    ...incoming[1],
    id: "remote-only-bookmark",
    parentId: null,
  } as BookmarkSyncNode
  await assert.rejects(
    () => bulkPutBookmarkNodes([...incoming, remoteOnly], committed),
    (error) => error instanceof StorageSyncConflictError,
  )
  assert.deepEqual(await idbGet(STORE_NODES, "sync-bookmark"), locallyEdited)
  assert.equal(await idbGet(STORE_NODES, "remote-only-bookmark"), undefined)
})

test("bookmark sync: a remote bookmark id cannot overwrite another node kind", async () => {
  const occupied = storedNote("bookmark-cross-kind", null, "a0")
  await idbPut(STORE_NODES, occupied)
  const incoming: BookmarkSyncNode[] = [
    {
      id: "safe-sync-folder",
      kind: "folder",
      title: "safe",
      parentId: null,
      sortKey: "a0",
      tags: [],
      createdAt: 1,
      updatedAt: 1,
      content: null,
    },
    {
      id: occupied.id,
      kind: "bookmark",
      title: "collision",
      parentId: null,
      sortKey: "a1",
      tags: [],
      createdAt: 1,
      updatedAt: 1,
      content: { url: "https://collision.example", description: "", favicon: "" },
    },
  ]

  await assert.rejects(() => bulkPutBookmarkNodes(incoming, []), /duplicate key/)

  assert.deepEqual(await idbGet(STORE_NODES, occupied.id), occupied)
  assert.equal(await idbGet(STORE_NODES, "safe-sync-folder"), undefined)
})

test("bookmark sync CAS: rejects orphan bookmarks atomically", async () => {
  const safeFolder: BookmarkSyncNode = {
    id: "safe-folder-before-orphan",
    kind: "folder",
    title: "safe",
    parentId: null,
    sortKey: "a0",
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    content: null,
  }
  const orphan: BookmarkSyncNode = {
    id: "orphan-bookmark",
    kind: "bookmark",
    title: "orphan",
    parentId: "missing-folder",
    sortKey: "a1",
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    content: { url: "https://example.com", description: "", favicon: "" },
  }

  await assert.rejects(() => bulkPutBookmarkNodes([safeFolder, orphan], []), /孤儿书签/)
  assert.equal(await idbGet(STORE_NODES, safeFolder.id), undefined)
  assert.equal(await idbGet(STORE_NODES, orphan.id), undefined)
})

test("note sync CAS: a stale merge cannot overwrite a move committed after listLocal", async () => {
  await idbPut(STORE_NODES, storedNote("old-parent", null, "a0"))
  await idbPut(STORE_NODES, storedNote("new-parent", null, "a1"))
  await idbPut(STORE_NODES, storedNote("child", "old-parent", "a2"))
  const expectedLocal = await listAllNotes()

  await updateNode("note", "child", { parentId: "new-parent", title: "local edit" })
  const afterLocal = await idbGet<NodeOfKind<"note">>(STORE_NODES, "child")
  assert.ok(afterLocal)
  const remoteRow = storedNote("remote-only", null, "a3")
  const { kind: _kind, ...remoteOnly } = remoteRow
  const incoming = [
    ...expectedLocal.map((note) =>
      note.id === "child"
        ? { ...note, title: "stale overwrite", updatedAt: afterLocal.updatedAt + 100 }
        : note,
    ),
    remoteOnly,
  ]
  indexGetAllModes.clear()
  await assert.rejects(
    () => bulkPutNotes(incoming, expectedLocal),
    (error) => error instanceof StorageSyncConflictError,
  )

  const child = await idbGet<NodeOfKind<"note">>(STORE_NODES, "child")
  assert.deepEqual(child, afterLocal)
  assert.equal(await idbGet(STORE_NODES, remoteRow.id), undefined)
  assert.deepEqual(indexGetAllModes.get(INDEX_NODES_KIND), ["readwrite"])
})

test("feed sync CAS: a stale merge cannot resurrect a locally removed subscription", async () => {
  const key = "stale.example"
  await addSubscription({ type: "publisher", key, title: "stale" })
  const expectedLocal = await listAllSubscriptions()

  await removeSubscription("publisher", key)
  const id = feedNodeId("publisher", key)
  const tombstone = await idbGet<NodeOfKind<"feed">>(STORE_NODES, id)
  const snapshot = await idbGet(STORE_TRASH_SNAPSHOTS, id)
  assert.ok(tombstone?.deletedAt)
  const incoming = [
    { ...expectedLocal[0], updatedAt: tombstone.updatedAt + 100 },
    {
      id: "publisher:remote-only.example",
      type: "publisher" as const,
      key: "remote-only.example",
      title: "remote only",
      favicon: "",
      createdAt: 10,
      updatedAt: 10,
    },
  ]
  indexGetAllModes.clear()
  await assert.rejects(
    () => bulkPutSubscriptions(incoming, expectedLocal),
    (error) => error instanceof StorageSyncConflictError,
  )

  assert.deepEqual(await idbGet(STORE_NODES, id), tombstone)
  assert.deepEqual(await idbGet(STORE_TRASH_SNAPSHOTS, id), snapshot)
  assert.equal(await idbGet(STORE_NODES, feedNodeId("publisher", "remote-only.example")), undefined)
  assert.deepEqual(indexGetAllModes.get(INDEX_NODES_KIND), ["readwrite"])
})

test("feed delete: a node write failure rolls back the preceding snapshot", async () => {
  const key = "rollback.example"
  await addSubscription({ type: "publisher", key, title: "rollback" })
  const id = feedNodeId("publisher", key)
  const original = await idbGet<NodeOfKind<"feed">>(STORE_NODES, id)
  failNextWriteStore = STORE_NODES

  await assert.rejects(() => removeSubscription("publisher", key), /injected nodes write failure/)

  assert.deepEqual(await idbGet(STORE_NODES, id), original)
  assert.equal(await idbGet(STORE_TRASH_SNAPSHOTS, id), undefined)
})

test("feed sync: tombstone, revival and GC evolve local trash snapshots atomically", async () => {
  const key = "snapshot-lifecycle.example"
  const live = await addSubscription({ type: "publisher", key, title: "live" })
  const expectedLive = await listAllSubscriptions()
  const deletedAt = live.updatedAt + 10
  const tombstone = { ...live, updatedAt: deletedAt, deletedAt }

  const committedTombstone = await bulkPutSubscriptions([tombstone], expectedLive)
  const id = feedNodeId("publisher", key)
  const snapshot = await idbGet<{ node: NodeOfKind<"feed"> }>(STORE_TRASH_SNAPSHOTS, id)
  assert.equal(snapshot?.node.deletedAt, undefined)
  assert.equal(snapshot?.node.title, "live")

  const { deletedAt: _deletedAt, ...tombstoneFields } = tombstone
  const revived = { ...tombstoneFields, title: "revived", updatedAt: deletedAt + 10 }
  const committedLive = await bulkPutSubscriptions([revived], committedTombstone)
  assert.equal((await idbGet<NodeOfKind<"feed">>(STORE_NODES, id))?.deletedAt, undefined)
  assert.equal(await idbGet(STORE_TRASH_SNAPSHOTS, id), undefined)

  const expiredAt = Date.now() - 91 * 24 * 60 * 60 * 1000
  const expired = { ...committedLive[0], updatedAt: expiredAt, deletedAt: expiredAt }
  await bulkPutSubscriptions([expired], committedLive)
  assert.ok(await idbGet(STORE_TRASH_SNAPSHOTS, id))
  await bulkPutSubscriptions([], [expired])
  assert.equal(await idbGet(STORE_NODES, id), undefined)
  assert.equal(await idbGet(STORE_TRASH_SNAPSHOTS, id), undefined)
})

test("note sync: tombstone, revival and GC evolve local trash snapshots atomically", async () => {
  const live = await addNote({ title: "note snapshot" })
  const expectedLive = await listAllNotes()
  const deletedAt = live.updatedAt + 10
  const tombstone = { ...live, content: [], updatedAt: deletedAt, deletedAt }

  const committedTombstone = await bulkPutNotes([tombstone], expectedLive)
  const snapshot = await idbGet<{ node: NodeOfKind<"note"> }>(STORE_TRASH_SNAPSHOTS, live.id)
  assert.equal(snapshot?.node.deletedAt, undefined)
  assert.equal(snapshot?.node.title, "note snapshot")

  const { deletedAt: _deletedAt, ...tombstoneFields } = tombstone
  const revived = {
    ...tombstoneFields,
    title: "revived note",
    updatedAt: deletedAt + 10,
  }
  const committedLive = await bulkPutNotes([revived], committedTombstone)
  assert.equal((await idbGet<NodeOfKind<"note">>(STORE_NODES, live.id))?.deletedAt, undefined)
  assert.equal(await idbGet(STORE_TRASH_SNAPSHOTS, live.id), undefined)

  const expiredAt = Date.now() - 91 * 24 * 60 * 60 * 1000
  const expired = { ...committedLive[0], content: [], updatedAt: expiredAt, deletedAt: expiredAt }
  await bulkPutNotes([expired], committedLive)
  assert.ok(await idbGet(STORE_TRASH_SNAPSHOTS, live.id))
  await bulkPutNotes([], [expired])
  assert.equal(await idbGet(STORE_NODES, live.id), undefined)
  assert.equal(await idbGet(STORE_TRASH_SNAPSHOTS, live.id), undefined)
})

test("feed sync: rejects non-canonical identities and unsafe tool URLs without partial writes", async () => {
  const expectedLocal = await listAllSubscriptions()
  const invalid = [
    {
      id: "publisher:forged.example",
      type: "publisher" as const,
      key: "actual.example",
      title: "forged",
      favicon: "",
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: "tool:javascript:alert(1)",
      type: "tool" as const,
      key: "javascript:alert(1)",
      title: "unsafe",
      favicon: "",
      createdAt: 1,
      updatedAt: 1,
    },
  ]

  for (const subscription of invalid) {
    await assert.rejects(() => bulkPutSubscriptions([subscription], expectedLocal))
  }
  assert.equal((await listAllSubscriptions()).length, 0)
})

test("feed sync: corrupted tail sort key fails closed and rolls back the batch", async () => {
  await idbPut(STORE_NODES, {
    id: feedNodeId("publisher", "corrupt.example"),
    kind: "feed",
    title: "corrupt",
    parentId: null,
    sortKey: "bad0",
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    content: { type: "publisher", key: "corrupt.example", favicon: "" },
  } satisfies NodeOfKind<"feed">)
  const expectedLocal = await listAllSubscriptions()
  const incoming = [
    ...expectedLocal,
    {
      id: "publisher:new.example",
      type: "publisher" as const,
      key: "new.example",
      title: "new",
      favicon: "",
      createdAt: 2,
      updatedAt: 2,
    },
  ]

  await assert.rejects(() => bulkPutSubscriptions(incoming, expectedLocal), /非法排序键/)
  assert.equal(await idbGet(STORE_NODES, feedNodeId("publisher", "new.example")), undefined)
})

test("feed sync: a raw node id that disagrees with content identity fails closed", async () => {
  const corrupt = {
    id: "feed:publisher:wrong.example",
    kind: "feed",
    title: "corrupt identity",
    parentId: null,
    sortKey: "a0",
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    content: { type: "publisher", key: "actual.example", favicon: "" },
  } satisfies NodeOfKind<"feed">
  await idbPut(STORE_NODES, corrupt)
  const expectedLocal = await listAllSubscriptions()

  await assert.rejects(
    () => bulkPutSubscriptions(expectedLocal, expectedLocal),
    /关注节点包含非规范身份/,
  )
  assert.deepEqual(await idbGet(STORE_NODES, corrupt.id), corrupt)
})

for (const failedStore of [STORE_TRASH_SNAPSHOTS, STORE_NODES, STORE_BLOBS] as const) {
  test(`file delete: a ${failedStore} write failure rolls back node, Blob and snapshot`, async () => {
    const id = `delete-rollback-${failedStore}`
    const original = await seedLiveFile(id)
    failNextWriteStore = failedStore

    await assert.rejects(() => deleteFile(id), new RegExp(`injected ${failedStore} write failure`))

    assert.deepEqual(await idbGet(STORE_NODES, id), original)
    assert.equal(await (await idbGet<{ blob: Blob }>(STORE_BLOBS, id))?.blob.text(), "body")
    assert.equal(await idbGet(STORE_TRASH_SNAPSHOTS, id), undefined)
  })
}

test("file delete: a commit abort rolls back node, Blob and snapshot", async () => {
  const id = "delete-commit-rollback"
  const original = await seedLiveFile(id)
  abortNextReadwriteCommit = true

  await assert.rejects(() => deleteFile(id), /injected readwrite commit abort/)

  assert.deepEqual(await idbGet(STORE_NODES, id), original)
  assert.equal(await (await idbGet<{ blob: Blob }>(STORE_BLOBS, id))?.blob.text(), "body")
  assert.equal(await idbGet(STORE_TRASH_SNAPSHOTS, id), undefined)
})

test("file delete/content update: delete-first concurrency cannot resurrect the file", async () => {
  const id = "delete-first-content-race"
  await seedLiveFile(id, "original")

  const [, updated] = await Promise.all([
    deleteFile(id),
    updateFileContent(id, "stale resurrection", "text/plain"),
  ])

  assert.equal(updated, undefined)
  assert.equal(await assertCoherentFileLifecycle(id, "original"), "tombstone")
})

test("file delete/content update: update-first concurrency snapshots the committed content", async () => {
  const id = "update-first-delete-race"
  await seedLiveFile(id, "original")

  const [updated] = await Promise.all([
    updateFileContent(id, "updated before delete", "text/plain"),
    deleteFile(id),
  ])

  assert.equal(updated?.blobRef.size, "updated before delete".length)
  assert.equal(await assertCoherentFileLifecycle(id, "updated before delete"), "tombstone")
})

test("file delete: a missing Blob removes an obsolete trash snapshot", async () => {
  const id = "delete-missing-blob"
  const original = storedFile(id)
  await idbPut(STORE_NODES, original)
  await idbPut(STORE_TRASH_SNAPSHOTS, {
    id,
    node: original,
    blob: new Blob(["obsolete"], { type: "text/plain" }),
    capturedAt: 1,
  })

  await deleteFile(id)

  const tombstone = await idbGet<NodeOfKind<"file">>(STORE_NODES, id)
  assert.ok(tombstone?.deletedAt != null)
  assert.equal(await idbGet(STORE_BLOBS, id), undefined)
  assert.equal(await idbGet(STORE_TRASH_SNAPSHOTS, id), undefined)
})

test("node mutation CAS: stale thread edit/delete cannot overwrite a newer generation", async () => {
  const original = { ...threadNode("thread-node-cas"), tags: ["keep"] }
  await idbPut(STORE_NODES, original)
  const stale = nodeMutationExpectation(original)
  const newer = { ...original, title: "external", updatedAt: original.updatedAt + 1 }
  await idbPut(STORE_NODES, newer)

  await assert.rejects(
    () => updateNode("thread", original.id, { title: "stale edit" }, stale),
    NodeMutationConflictError,
  )
  await assert.rejects(() => deleteNode("thread", original.id, stale), NodeMutationConflictError)
  assert.deepEqual(await idbGet(STORE_NODES, original.id), newer)

  const updated = await updateNode(
    "thread",
    original.id,
    { title: "committed" },
    nodeMutationExpectation(newer),
  )
  assert.equal(updated?.kind, "thread")
  assert.equal(updated?.title, "committed")
  assert.deepEqual(updated?.tags, ["keep"])
  assert.deepEqual(await idbGet(STORE_NODES, original.id), updated)
  assert.equal(await deleteNode("thread", original.id, nodeMutationExpectation(updated!)), true)
  assert.equal(await deleteNode("thread", original.id), false)
  await assert.rejects(
    () => deleteNode("thread", original.id, nodeMutationExpectation(updated!)),
    NodeMutationConflictError,
  )
})

test("node mutation CAS: stale note and file-content writes preserve the committed values", async () => {
  const note = storedNote("note-node-cas", null, "a0")
  const file = await seedLiveFile("file-content-cas", "committed body")
  await idbPut(STORE_NODES, note)
  const newerNote = { ...note, title: "external", updatedAt: note.updatedAt + 1 }
  const newerFile = { ...file, title: "external.txt", updatedAt: file.updatedAt + 1 }
  await idbPut(STORE_NODES, newerNote)
  await idbPut(STORE_NODES, newerFile)

  await assert.rejects(
    () => updateNode("note", note.id, { title: "stale" }, nodeMutationExpectation(note)),
    NodeMutationConflictError,
  )
  await assert.rejects(
    () => updateFileContent(file.id, "stale body", "text/plain", nodeMutationExpectation(file)),
    NodeMutationConflictError,
  )
  assert.deepEqual(await idbGet(STORE_NODES, note.id), newerNote)
  assert.deepEqual(await idbGet(STORE_NODES, file.id), newerFile)
  assert.equal(
    await (await idbGet<{ blob: Blob }>(STORE_BLOBS, file.id))?.blob.text(),
    "committed body",
  )
})

test("node restore: a forged kind cannot restore a note outside subtree semantics", async () => {
  const note = {
    ...storedNote("restore-kind-guard", null, "a0"),
    content: [{ type: "p", children: [{ text: "kept body" }] }],
  } satisfies NodeOfKind<"note">
  await idbPut(STORE_NODES, note)
  await deleteNote(note.id)
  const tombstone = await idbGet<NodeOfKind<"note">>(STORE_NODES, note.id)
  assert.ok(tombstone?.deletedAt != null)

  assert.equal(await restoreNode("bookmark", note.id), false)
  assert.deepEqual(await idbGet(STORE_NODES, note.id), tombstone)
  assert.equal(await restoreNode("note", note.id), true)
  const restored = await idbGet<NodeOfKind<"note">>(STORE_NODES, note.id)
  assert.equal(restored?.deletedAt, undefined)
  assert.deepEqual(restored?.content, note.content)
})

test("node update: supported empty edits return the current live node without a version bump", async () => {
  const bookmark = storedBookmark("bookmark-noop", null, "a0")
  const file = await seedLiveFile("file-noop")
  await idbPut(STORE_NODES, bookmark)

  assert.deepEqual(
    await updateNode(
      "bookmark",
      bookmark.id,
      { parentId: null },
      nodeMutationExpectation(bookmark),
    ),
    bookmark,
  )
  assert.deepEqual(await updateNode("file", file.id, {}, nodeMutationExpectation(file)), file)
  assert.deepEqual(await idbGet(STORE_NODES, bookmark.id), bookmark)
  assert.deepEqual(await idbGet(STORE_NODES, file.id), file)
})

test("file create: a late Blob write failure rolls back the node and its tail key", async () => {
  failNextWriteStore = STORE_BLOBS
  await assert.rejects(
    () => addFile(new File(["failed"], "failed.txt", { type: "text/plain" })),
    /injected blobs write failure/,
  )

  assert.equal(fakeDbs.get(IDB_DATABASE_NAME)?.stores.get(STORE_NODES)?.rows.size, 0)
  assert.equal(fakeDbs.get(IDB_DATABASE_NAME)?.stores.get(STORE_BLOBS)?.rows.size, 0)
  const created = await addFile(new File(["ok"], "ok.txt", { type: "text/plain" }))
  const node = await idbGet<NodeOfKind<"file">>(STORE_NODES, created.id)
  assert.equal(node?.sortKey, "a0")
})

test("restore: tombstones reuse their keys while missing bookmark and file rows seek a new tail", async () => {
  await idbPut(STORE_NODES, {
    id: "bookmark-tomb",
    kind: "bookmark",
    title: "old bookmark",
    parentId: null,
    sortKey: "a5",
    tags: [],
    createdAt: 1,
    updatedAt: 2,
    deletedAt: 3,
    content: { url: "https://old.example", description: "", favicon: "" },
  } satisfies NodeOfKind<"bookmark">)
  await idbPut(STORE_NODES, {
    id: "file-tomb",
    kind: "file",
    title: "old file",
    parentId: null,
    sortKey: "a5",
    tags: [],
    createdAt: 1,
    updatedAt: 2,
    deletedAt: 3,
    blobRef: { store: "blobs", key: "file-tomb", size: 0, mime: "text/plain" },
    content: null,
  } satisfies NodeOfKind<"file">)

  await restoreBookmark({
    id: "bookmark-tomb",
    title: "restored",
    url: "https://restored.example",
    description: "",
    favicon: "",
    folderId: null,
    tags: [],
    createdAt: 1,
  })
  await restoreFile({
    id: "file-tomb",
    name: "restored.txt",
    type: "text/plain",
    size: 8,
    blob: new Blob(["restored"], { type: "text/plain" }),
    createdAt: 1,
    tags: [],
  })
  await restoreBookmark({
    id: "bookmark-missing",
    title: "rebuilt",
    url: "https://rebuilt.example",
    description: "",
    favicon: "",
    folderId: null,
    tags: [],
    createdAt: 1,
  })
  await restoreFile({
    id: "file-missing",
    name: "rebuilt.txt",
    type: "text/plain",
    size: 7,
    blob: new Blob(["rebuilt"], { type: "text/plain" }),
    createdAt: 1,
    tags: [],
  })

  assert.equal((await idbGet<NodeOfKind<"bookmark">>(STORE_NODES, "bookmark-tomb"))?.sortKey, "a5")
  assert.equal((await idbGet<NodeOfKind<"file">>(STORE_NODES, "file-tomb"))?.sortKey, "a5")
  const rebuiltBookmarkKey = (await idbGet<NodeOfKind<"bookmark">>(STORE_NODES, "bookmark-missing"))
    ?.sortKey
  const rebuiltFileKey = (await idbGet<NodeOfKind<"file">>(STORE_NODES, "file-missing"))?.sortKey
  assert.ok(typeof rebuiltBookmarkKey === "string" && rebuiltBookmarkKey > "a5")
  assert.ok(typeof rebuiltFileKey === "string" && rebuiltFileKey > "a5")
  assert.equal(keyCursorVisits.get(INDEX_NODES_KIND_SORT_KEY), 2)
})

test("hot writes: initialized state uses task primary keys without agent_tasks getAll", async () => {
  const created = await createTaskThread("workspace-a")
  const scansAfterInitialization = getAllCalls.get(STORE_AGENT_TASKS) ?? 0

  await attachThreadTask("workspace-b", created.thread.id)
  await updateThreadTask(created.thread.id, { status: "running" })
  await saveThreadAndTouchTaskAtomic({
    ...created.thread,
    messages: [{ role: "user", content: "point read" }],
  })

  await idbPut(STORE_NODES, threadNode("attached"))
  await attachThreadTask("workspace-a", "attached")
  const second = await createTaskThread("workspace-a")
  await deleteTaskThread(second.thread.id)

  assert.equal(getAllCalls.get(STORE_AGENT_TASKS), scansAfterInitialization)
  assert.deepEqual(await readThreadTaskIndexHead(), { revision: 6, count: 2 })
})

test("capacity: durable count rejects create and attach without scanning or drifting", async () => {
  await idbPut(STORE_AGENT_TASKS, {
    key: "state",
    type: "state",
    revision: 9,
    count: MAX_THREAD_TASK_ITEMS,
    legacyMigrated: true,
  })
  await idbPut(STORE_NODES, threadNode("attach-overflow"))
  const scansBefore = getAllCalls.get(STORE_AGENT_TASKS) ?? 0
  const nodesBefore = fakeDbs.get(IDB_DATABASE_NAME)?.stores.get(STORE_NODES)?.rows.size

  await assert.rejects(() => createTaskThread("workspace-a"), /不能超过/)
  await assert.rejects(() => attachThreadTask("workspace-a", "attach-overflow"), /不能超过/)
  assert.equal(getAllCalls.get(STORE_AGENT_TASKS) ?? 0, scansBefore)
  assert.equal(fakeDbs.get(IDB_DATABASE_NAME)?.stores.get(STORE_NODES)?.rows.size, nodesBefore)
  assert.deepEqual(await readThreadTaskIndexHead(), {
    revision: 9,
    count: MAX_THREAD_TASK_ITEMS,
  })
})

test("create: a task-store failure rolls back the thread node and reserved tail key", async () => {
  assert.deepEqual(await readThreadTaskIndexHead(), { revision: 0, count: 0 })
  const nodesBefore = fakeDbs.get(IDB_DATABASE_NAME)?.stores.get(STORE_NODES)?.rows.size
  failNextWriteStore = STORE_AGENT_TASKS

  await assert.rejects(() => createTaskThread("workspace-a"), /injected agent_tasks write failure/)

  assert.equal(fakeDbs.get(IDB_DATABASE_NAME)?.stores.get(STORE_NODES)?.rows.size, nodesBefore)
  assert.deepEqual(await readThreadTaskIndexHead(), { revision: 0, count: 0 })
  const ordinary = await createThread()
  const node = await idbGet<NodeOfKind<"thread">>(STORE_NODES, ordinary.id)
  assert.equal(node?.sortKey, "a0")
})

test("attach: deleted or missing thread is rejected without a dangling task", async () => {
  await idbPut(STORE_NODES, threadNode("deleted", 100))

  await assert.rejects(() => attachThreadTask("workspace-a", "deleted"), /不存在或已删除/)
  await assert.rejects(() => attachThreadTask("workspace-a", "missing"), /不存在或已删除/)
  assert.deepEqual(await listThreadTasks(), { revision: 0, tasks: [] })
})

test("delete: snapshot, tombstone and task removal commit together", async () => {
  const created = await createTaskThread("workspace-a")
  const before = await idbGet<NodeOfKind<"thread">>(STORE_NODES, created.thread.id)

  const result = await deleteTaskThread(created.thread.id)
  const deleted = await idbGet<NodeOfKind<"thread">>(STORE_NODES, created.thread.id)
  const trash = await idbGet<{ id: string; node: NodeOfKind<"thread"> }>(
    STORE_TRASH_SNAPSHOTS,
    created.thread.id,
  )
  assert.equal(result.revision, 2)
  assert.equal(result.deleted, true)
  assert.ok(deleted?.deletedAt)
  assert.ok((deleted?.updatedAt ?? 0) > (before?.updatedAt ?? 0))
  assert.deepEqual(trash?.node, before)
  assert.deepEqual(await listThreadTasks(), { revision: 2, tasks: [] })
  assert.deepEqual(await readThreadTaskIndexHead(), { revision: 2, count: 0 })

  const retry = await deleteTaskThread(created.thread.id)
  assert.equal(retry.revision, 2)
  assert.equal(retry.deleted, false)
  assert.deepEqual(await listThreadTasks(), { revision: 2, tasks: [] })
})

test("delete: stale thread expectation preserves a task that was edited after creation", async () => {
  const created = await createTaskThread("workspace-a")
  const saved = await saveThreadAndTouchTaskAtomic({
    ...created.thread,
    messages: [{ role: "assistant", content: "continued" }],
  })

  await assert.rejects(
    () =>
      deleteTaskThread(created.thread.id, {
        kind: "thread",
        updatedAt: created.thread.updatedAt,
        deletedAt: null,
      }),
    /节点在写入前已变更/,
  )
  assert.equal(
    (await idbGet<NodeOfKind<"thread">>(STORE_NODES, created.thread.id))?.deletedAt,
    undefined,
  )
  assert.equal((await listThreadTasks()).tasks.length, 1)

  const deleted = await deleteTaskThread(created.thread.id, {
    kind: "thread",
    updatedAt: saved.thread.updatedAt,
    deletedAt: null,
  })
  assert.equal(deleted.deleted, true)
})

test("delete: a late node write failure rolls back trash snapshot and task removal", async () => {
  const created = await createTaskThread("workspace-a")
  const before = await idbGet<NodeOfKind<"thread">>(STORE_NODES, created.thread.id)
  failNextWriteStore = STORE_NODES

  await assert.rejects(() => deleteTaskThread(created.thread.id), /injected nodes write failure/)

  assert.deepEqual(await idbGet<NodeOfKind<"thread">>(STORE_NODES, created.thread.id), before)
  assert.equal(await idbGet(STORE_TRASH_SNAPSHOTS, created.thread.id), undefined)
  assert.deepEqual(await listThreadTasks(), { revision: 1, tasks: [created.task] })
})

test("replace: validates live refs, enforces CAS/capacity and keeps no-op revision stable", async () => {
  await idbPut(STORE_NODES, threadNode("a"))
  await idbPut(STORE_NODES, threadNode("b"))
  await idbPut(STORE_NODES, threadNode("deleted", 100))
  const values = [task("a", 30), task("b", 40)]

  const first = await replaceThreadTasks(values, 0)
  assert.equal(first.revision, 1)
  assert.deepEqual(
    first.tasks.map((value) => value.id),
    ["b", "a"],
  )
  assert.equal((await replaceThreadTasks(values, 1)).revision, 1)

  await assert.rejects(() => replaceThreadTasks([], 0), ThreadTaskConflictError)
  await assert.rejects(() => replaceThreadTasks([task("deleted")], 1), /不存在或已删除/)
  await assert.rejects(() => replaceThreadTasks([task("missing")], 1), /不存在或已删除/)
  assert.deepEqual(await listThreadTasks(), first)

  const oversized = Array.from({ length: MAX_THREAD_TASK_ITEMS + 1 }, (_, index) =>
    task(`overflow-${index}`),
  )
  await assert.rejects(() => replaceThreadTasks(oversized), /不能超过/)
  assert.deepEqual(await listThreadTasks(), first)

  const cleared = await replaceThreadTasks([], 1)
  assert.deepEqual(cleared, { revision: 2, tasks: [] })
  assert.deepEqual(await readThreadTaskIndexHead(), { revision: 2, count: 0 })
})

test("save: thread body and task touch share updatedAt/revision while preserving node metadata", async () => {
  const created = await createTaskThread("workspace-a")
  const base = await idbGet<NodeOfKind<"thread">>(STORE_NODES, created.thread.id)
  assert.ok(base)
  await idbPut(STORE_NODES, { ...base, meta: { source: "test" } })

  const saved = await saveThreadAndTouchTaskAtomic({
    ...created.thread,
    title: "renamed",
    messages: [{ role: "assistant", content: "saved" }],
  })
  const node = await idbGet<NodeOfKind<"thread">>(STORE_NODES, created.thread.id)
  assert.equal(saved.revision, 2)
  assert.equal(saved.thread.title, "renamed")
  assert.equal(saved.task?.updatedAt, saved.thread.updatedAt)
  assert.equal(node?.updatedAt, saved.thread.updatedAt)
  assert.equal(node?.sortKey, base?.sortKey)
  assert.equal(node?.createdAt, base?.createdAt)
  assert.deepEqual(node?.meta, { source: "test" })
  assert.deepEqual(node?.content.messages, [{ role: "assistant", content: "saved" }])
})

test("save: a task-store failure rolls back the preceding thread body write", async () => {
  const created = await createTaskThread("workspace-a")
  const beforeNode = await idbGet<NodeOfKind<"thread">>(STORE_NODES, created.thread.id)
  failNextWriteStore = STORE_AGENT_TASKS

  await assert.rejects(
    () =>
      saveThreadAndTouchTaskAtomic({
        ...created.thread,
        title: "must-roll-back",
        messages: [{ role: "assistant", content: "must-roll-back" }],
      }),
    /injected agent_tasks write failure/,
  )

  assert.deepEqual(await idbGet<NodeOfKind<"thread">>(STORE_NODES, created.thread.id), beforeNode)
  assert.deepEqual(await listThreadTasks(), { revision: 1, tasks: [created.task] })
})
