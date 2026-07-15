import assert from "node:assert/strict"
import { test } from "node:test"
import type { DirectoryEntry, FileRef } from "@protocol/file-system"
import type { DirectoryPage, FileSystemWatchHandle } from "@/filesystem/types"
import {
  PagedDirectoryController,
  type PagedDirectoryGateway,
  type PagedDirectorySnapshot,
} from "./paged-directory"

const DIRECTORY_REF: FileRef = { fileSystemId: "test.directory", fileId: "tasks" }

function entry(id: string): DirectoryEntry {
  return {
    entryId: id,
    parent: DIRECTORY_REF,
    target: { fileSystemId: "test.targets", fileId: id },
    name: id,
    kind: "link",
  }
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test("paged directory: reads cursor pages, deduplicates entry ids, and keeps pages separate", async () => {
  const requests: Array<{ cursor?: string; limit?: number }> = []
  const pages: DirectoryPage[] = [
    { entries: [entry("a"), entry("b")], nextCursor: "cursor-2" },
    { entries: [entry("b"), entry("c")], nextCursor: "cursor-3" },
    { entries: [entry("d")] },
  ]
  const snapshots: PagedDirectorySnapshot[] = []
  const controller = new PagedDirectoryController(
    DIRECTORY_REF,
    {
      async read(_ref, options) {
        requests.push(options)
        return pages.shift()!
      },
      watch: () => null,
    },
    (snapshot) => snapshots.push(snapshot),
    { pageSize: 2, maxPages: 3, maxEntries: 4 },
  )

  assert.equal(await controller.start(), true)
  assert.equal(await controller.loadMore(), true)
  assert.equal(await controller.loadMore(), true)
  assert.equal(await controller.loadMore(), false)

  assert.deepEqual(requests, [
    { limit: 2 },
    { limit: 2, cursor: "cursor-2" },
    { limit: 2, cursor: "cursor-3" },
  ])
  assert.deepEqual(
    controller.snapshot().pages.map((page) => page.entries.map((item) => item.entryId)),
    [["a", "b"], ["c"], ["d"]],
  )
  assert.equal(controller.snapshot().nextCursor, undefined)
  assert.equal(controller.snapshot().error, null)
  assert.ok(snapshots.length >= 6)
  controller.dispose()
})

test("paged directory: structural watch bursts reset once and preserve last-good pages on failure", async () => {
  let reads = 0
  let notify: (() => void) | undefined
  let fail = false
  const oldPage = { entries: [entry("old")], nextCursor: "old-next" }
  const newPage = { entries: [entry("new")] }
  const gateway: PagedDirectoryGateway = {
    async read() {
      reads += 1
      if (fail) throw new Error("temporarily unavailable")
      return reads === 1 ? oldPage : newPage
    },
    watch(_ref, listener) {
      notify = listener
      return { dispose() {} }
    },
  }
  const controller = new PagedDirectoryController(DIRECTORY_REF, gateway, () => {})

  await controller.start()
  fail = true
  for (let index = 0; index < 100; index += 1) notify?.()
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(reads, 2)
  assert.deepEqual(
    controller.snapshot().pages[0]?.entries.map((item) => item.entryId),
    ["old"],
  )
  assert.equal(controller.snapshot().nextCursor, undefined)
  assert.equal(controller.snapshot().loading, false)
  assert.ok(controller.snapshot().error instanceof Error)
  assert.equal(controller.snapshot().resetVersion, 2)

  fail = false
  assert.equal(await controller.reset(), true)
  assert.deepEqual(
    controller.snapshot().pages[0]?.entries.map((item) => item.entryId),
    ["new"],
  )
  assert.equal(controller.snapshot().resetVersion, 3)
  controller.dispose()
})

test("paged directory: reset isolates a late page and permits the new cursor immediately", async () => {
  const stalePage = deferred<DirectoryPage>()
  const resetPage = deferred<DirectoryPage>()
  const freshPage = deferred<DirectoryPage>()
  const cursors: Array<string | undefined> = []
  const controller = new PagedDirectoryController(
    DIRECTORY_REF,
    {
      read(_ref, options) {
        cursors.push(options.cursor)
        if (cursors.length === 1) {
          return Promise.resolve({ entries: [entry("initial")], nextCursor: "stale-cursor" })
        }
        if (cursors.length === 2) return stalePage.promise
        if (cursors.length === 3) return resetPage.promise
        return freshPage.promise
      },
      watch: () => null,
    },
    () => {},
  )

  await controller.start()
  const stalePending = controller.loadMore()
  const resetPending = controller.reset()
  resetPage.resolve({ entries: [entry("reset")], nextCursor: "fresh-cursor" })
  assert.equal(await resetPending, true)

  const freshPending = controller.loadMore()
  assert.deepEqual(cursors, [undefined, "stale-cursor", undefined, "fresh-cursor"])
  freshPage.resolve({ entries: [entry("fresh")] })
  assert.equal(await freshPending, true)

  stalePage.resolve({ entries: [entry("stale")] })
  assert.equal(await stalePending, false)
  assert.deepEqual(
    controller.snapshot().pages.map((page) => page.entries.map((item) => item.entryId)),
    [["reset"], ["fresh"]],
  )
  controller.dispose()
})

test("paged directory: provider revision seed remains visible until the new first page wins", async () => {
  const next = deferred<DirectoryPage>()
  const seed: PagedDirectorySnapshot = {
    pages: [{ entries: [entry("last-good")] }],
    nextCursor: "provider-specific-stale-cursor",
    loading: false,
    loadingMore: false,
    error: new Error("old error"),
    resetVersion: 7,
  }
  const controller = new PagedDirectoryController(
    DIRECTORY_REF,
    { read: () => next.promise, watch: () => null },
    () => {},
    { seed },
  )

  assert.deepEqual(controller.snapshot().pages, seed.pages)
  assert.equal(controller.snapshot().nextCursor, undefined)
  const pending = controller.start()
  assert.equal(controller.snapshot().loading, true)
  assert.deepEqual(controller.snapshot().pages, seed.pages)
  assert.equal(controller.snapshot().resetVersion, 8)

  next.resolve({ entries: [entry("provider-new")] })
  assert.equal(await pending, true)
  assert.deepEqual(
    controller.snapshot().pages[0]?.entries.map((item) => item.entryId),
    ["provider-new"],
  )
  assert.equal(controller.snapshot().error, null)
  controller.dispose()
})

test("paged directory: cursor loops fail closed without replacing loaded pages", async () => {
  let reads = 0
  const controller = new PagedDirectoryController(
    DIRECTORY_REF,
    {
      async read() {
        reads += 1
        return reads === 1
          ? { entries: [entry("a")], nextCursor: "loop" }
          : { entries: [entry("b")], nextCursor: "loop" }
      },
      watch: () => null,
    },
    () => {},
  )

  await controller.start()
  assert.equal(await controller.loadMore(), false)
  assert.deepEqual(
    controller.snapshot().pages[0]?.entries.map((item) => item.entryId),
    ["a"],
  )
  assert.equal(controller.snapshot().pages.length, 1)
  assert.equal(controller.snapshot().nextCursor, "loop")
  assert.ok(controller.snapshot().error instanceof Error)
  controller.dispose()
})

test("paged directory: dispose tears down watch and blocks late initial publication", async () => {
  const initial = deferred<DirectoryPage>()
  let disposed = 0
  const snapshots: PagedDirectorySnapshot[] = []
  const handle: FileSystemWatchHandle = { dispose: () => disposed++ }
  const controller = new PagedDirectoryController(
    DIRECTORY_REF,
    { read: () => initial.promise, watch: () => handle },
    (snapshot) => snapshots.push(snapshot),
  )

  const pending = controller.start()
  assert.equal(snapshots.length, 1)
  controller.dispose()
  initial.resolve({ entries: [entry("late")] })
  assert.equal(await pending, false)
  assert.equal(snapshots.length, 1)
  assert.equal(disposed, 1)
})
