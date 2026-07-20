import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import {
  registerStorageSyncPort,
  StorageSyncConflictError,
  type BookmarkSyncNode,
  type StorageSyncPort,
} from "@protocol/storage-sync"
import { recordsEqual } from "@protocol/sync"
import { decryptJson, deriveKeys, encryptJson } from "@/lib/sync-crypto"
import { gcBookmarks, isValidRemoteBookmarkNode, syncBookmarks } from "./bookmarks-sync"
import { makeSyncTestServer } from "./sync-test-server"

const CODE = "0123456789abcdef0123456789abcdef"

function folder(over: Partial<BookmarkSyncNode> = {}): BookmarkSyncNode {
  return {
    id: "folder-1",
    kind: "folder",
    title: "收藏夹",
    parentId: null,
    sortKey: "a0",
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    content: null,
    ...over,
  } as BookmarkSyncNode
}

function bookmark(over: Partial<BookmarkSyncNode> = {}): BookmarkSyncNode {
  return {
    id: "bookmark-1",
    kind: "bookmark",
    title: "链接",
    parentId: null,
    sortKey: "a0",
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    content: { url: "https://example.com", description: "", favicon: "" },
    ...over,
  } as BookmarkSyncNode
}

test("bookmark remote validation: accepts nodes and rejects unsafe URLs or nested folders", () => {
  assert.equal(isValidRemoteBookmarkNode(folder()), true)
  assert.equal(isValidRemoteBookmarkNode(bookmark()), true)
  assert.equal(
    isValidRemoteBookmarkNode(
      bookmark({
        content: { url: "javascript:alert(1)", description: "", favicon: "" },
      } as Partial<BookmarkSyncNode>),
    ),
    false,
  )
  assert.equal(isValidRemoteBookmarkNode(folder({ parentId: "another-folder" })), false)
})

test("bookmark collection GC: 孤儿与已删除父夹下书签确定性归根", () => {
  const nodes = gcBookmarks(
    [
      folder({ id: "live-folder", updatedAt: 3 }),
      folder({ id: "deleted-folder", updatedAt: 10, deletedAt: 10 }),
      bookmark({ id: "kept", parentId: "live-folder", updatedAt: 4 }),
      bookmark({ id: "missing-parent", parentId: "missing", updatedAt: 5 }),
      bookmark({ id: "deleted-parent", parentId: "deleted-folder", updatedAt: 6 }),
    ],
    20,
  )

  assert.equal(nodes.find((node) => node.id === "kept")?.parentId, "live-folder")
  const missing = nodes.find((node) => node.id === "missing-parent")
  assert.equal(missing?.parentId, null)
  assert.equal(missing?.updatedAt, 6)
  const deleted = nodes.find((node) => node.id === "deleted-parent")
  assert.equal(deleted?.parentId, null)
  assert.equal(deleted?.updatedAt, 11)
})

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

function makeBookmarkHub(initial: BookmarkSyncNode[]) {
  const store = structuredClone(initial)
  const bulkCalls: Array<{
    items: BookmarkSyncNode[]
    expectedLocal: BookmarkSyncNode[]
  }> = []
  const port: StorageSyncPort = {
    async listAllSubscriptions() {
      throw new Error("bookmark test hub does not implement subscriptions")
    },
    async bulkPutSubscriptions() {
      throw new Error("bookmark test hub does not implement subscriptions")
    },
    async listAllNotes() {
      throw new Error("bookmark test hub does not implement notes")
    },
    async bulkPutNotes() {
      throw new Error("bookmark test hub does not implement notes")
    },
    async listAllBookmarkNodes() {
      return structuredClone(store)
    },
    async bulkPutBookmarkNodes(items, expectedLocal) {
      bulkCalls.push({
        items: structuredClone(items),
        expectedLocal: structuredClone(expectedLocal),
      })
      if (recordsEqual(store, items)) return structuredClone(store)
      if (!recordsEqual(store, expectedLocal)) throw new StorageSyncConflictError("书签")
      store.length = 0
      store.push(...structuredClone(items))
      return structuredClone(store)
    },
  }
  registerStorageSyncPort(port)
  return { store, bulkCalls }
}

test("syncBookmarks: merges folder and bookmark in one CAS snapshot and uploads ciphertext", async () => {
  const { key } = await deriveKeys(CODE, "bookmarks")
  const remote = [
    folder({ id: "remote-folder", updatedAt: 2 }),
    bookmark({ id: "remote-bookmark", parentId: "remote-folder", updatedAt: 2 }),
  ]
  const encrypted = await encryptJson(key, remote)
  const server = makeSyncTestServer({ ...encrypted, updated_at: 100 })
  const local = [bookmark({ id: "local-bookmark" })]
  const hub = makeBookmarkHub(local)

  const result = await syncBookmarks(CODE)

  assert.equal(hub.bulkCalls.length, 1)
  assert.deepEqual(hub.bulkCalls[0]?.expectedLocal, local)
  assert.deepEqual(hub.store.map((item) => item.id).sort(), [
    "local-bookmark",
    "remote-bookmark",
    "remote-folder",
  ])
  assert.equal(result.total, 3)
  assert.equal(result.added, 2)
  assert.equal(server.putCount, 1)
  const decoded = await decryptJson<BookmarkSyncNode[]>(
    key,
    server.blob!.iv,
    server.blob!.ciphertext,
  )
  assert.deepEqual(decoded.map((item) => item.id).sort(), hub.store.map((item) => item.id).sort())
})

test("syncBookmarks: 远端孤儿书签在落地和回传前移到根级", async () => {
  const { key } = await deriveKeys(CODE, "bookmarks")
  const remote = [bookmark({ id: "orphan", parentId: "missing-folder", updatedAt: 8 })]
  const encrypted = await encryptJson(key, remote)
  const server = makeSyncTestServer({ ...encrypted, updated_at: 100 })
  const hub = makeBookmarkHub([])

  await syncBookmarks(CODE)

  const stored = hub.store.find((node) => node.id === "orphan")
  assert.equal(stored?.parentId, null)
  assert.equal(stored?.updatedAt, 9)
  const decoded = await decryptJson<BookmarkSyncNode[]>(
    key,
    server.blob!.iv,
    server.blob!.ciphertext,
  )
  assert.equal(decoded[0]?.parentId, null)
  assert.equal(server.putCount, 1)
})
