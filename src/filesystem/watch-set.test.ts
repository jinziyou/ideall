import { test } from "node:test"
import assert from "node:assert/strict"
import type { FileRef } from "@protocol/file-system"
import { registerFileSystem } from "./registry"
import type { FileSystemProvider, FileSystemWatchEvent } from "./types"
import { FileSystemError } from "./types"
import { FileSystemWatchEventHub, watchFileSet } from "./watch-set"

function provider(id: string, onDispose: () => void): FileSystemProvider {
  const root: FileRef = { fileSystemId: id, fileId: "root" }
  return {
    descriptor: {
      fileSystemId: id,
      name: id,
      root,
      source: { kind: "local", id },
    },
    async stat() {
      return null
    },
    async readDirectory() {
      return { entries: [] }
    },
    async read() {
      throw new FileSystemError("unsupported", "unused")
    },
    async write() {
      throw new FileSystemError("unsupported", "unused")
    },
    async actions() {
      return []
    },
    async invoke() {
      throw new FileSystemError("unsupported", "unused")
    },
    watch() {
      return { dispose: onDispose }
    },
  }
}

test("watchFileSet deduplicates refs and disposes every provider handle", () => {
  let disposed = 0
  const first = { fileSystemId: "watch-set.first", fileId: "root" }
  const second = { fileSystemId: "watch-set.second", fileId: "root" }
  const unregisterFirst = registerFileSystem(provider(first.fileSystemId, () => disposed++))
  const unregisterSecond = registerFileSystem(provider(second.fileSystemId, () => disposed++))
  try {
    const handle = watchFileSet(
      [first, first, second, { fileSystemId: "watch-set.missing", fileId: "root" }],
      { actor: "ui", permissions: [], intent: "watch" },
      () => {},
    )
    assert.ok(handle)
    handle.dispose()
    handle.dispose()
    assert.equal(disposed, 2)
  } finally {
    unregisterSecond()
    unregisterFirst()
  }
})

test("FileSystemWatchEventHub coalesces a batch and preserves incremental child details", () => {
  const hub = new FileSystemWatchEventHub()
  const parent: FileRef = { fileSystemId: "watch-hub", fileId: "parent" }
  const first: FileRef = { fileSystemId: "watch-hub", fileId: "first" }
  const second: FileRef = { fileSystemId: "watch-hub", fileId: "second" }
  const parentEvents: FileSystemWatchEvent[] = []
  hub.watch(parent, (event) => parentEvents.push(event))

  hub.batch(() => {
    hub.emit({
      type: "created",
      ref: first,
      entryId: "first-entry",
      newParent: parent,
      version: "1",
    })
    hub.emit({ type: "changed", ref: first, newParent: parent, version: "2" })
    hub.emit({
      type: "created",
      ref: second,
      entryId: "second-entry",
      newParent: parent,
      version: "1",
    })
  })

  assert.equal(parentEvents.length, 1)
  assert.equal(parentEvents[0]?.ref.fileId, "parent")
  assert.equal(parentEvents[0]?.changes?.length, 2)
  assert.deepEqual(
    parentEvents[0]?.changes?.map((event) => [event.type, event.ref.fileId, event.version]),
    [
      ["created", "first", "2"],
      ["created", "second", "1"],
    ],
  )
})

test("FileSystemWatchEventHub routes create, move, and delete to affected parent directories", () => {
  const hub = new FileSystemWatchEventHub()
  const oldParent: FileRef = { fileSystemId: "watch-hub", fileId: "old-parent" }
  const newParent: FileRef = { fileSystemId: "watch-hub", fileId: "new-parent" }
  const child: FileRef = { fileSystemId: "watch-hub", fileId: "child" }
  const oldEvents: string[] = []
  const newEvents: string[] = []
  const childEvents: string[] = []
  hub.watch(oldParent, (event) => oldEvents.push(`${event.type}:${event.entryId}`))
  hub.watch(newParent, (event) => newEvents.push(`${event.type}:${event.entryId}`))
  hub.watch(child, (event) => childEvents.push(`${event.type}:${event.entryId}`))

  hub.emit({ type: "created", ref: child, entryId: "entry", newParent: oldParent })
  hub.emit({
    type: "changed",
    ref: child,
    entryId: "entry",
    oldParent,
    newParent,
    version: "2",
  })
  hub.emit({ type: "deleted", ref: child, entryId: "entry", oldParent: newParent })

  assert.deepEqual(oldEvents, ["created:entry", "changed:entry"])
  assert.deepEqual(newEvents, ["changed:entry", "deleted:entry"])
  assert.deepEqual(childEvents, ["created:entry", "changed:entry", "deleted:entry"])
})

test("FileSystemWatchEventHub keeps distinct directory links to the same FileRef", () => {
  const hub = new FileSystemWatchEventHub()
  const parent: FileRef = { fileSystemId: "watch-hub", fileId: "parent" }
  const child: FileRef = { fileSystemId: "watch-hub", fileId: "shared" }
  const events: FileSystemWatchEvent[] = []
  hub.watch(parent, (event) => events.push(event))
  hub.batch(() => {
    hub.emit({ type: "created", ref: child, entryId: "link-a", newParent: parent })
    hub.emit({ type: "created", ref: child, entryId: "link-b", newParent: parent })
  })
  assert.deepEqual(
    events[0]?.changes?.map((event) => event.entryId),
    ["link-a", "link-b"],
  )
})

test("FileSystemWatchEventHub scopes entryId identity to its parent directory", () => {
  const hub = new FileSystemWatchEventHub()
  const firstParent: FileRef = { fileSystemId: "watch-hub", fileId: "first-parent" }
  const secondParent: FileRef = { fileSystemId: "watch-hub", fileId: "second-parent" }
  const child: FileRef = { fileSystemId: "watch-hub", fileId: "shared" }
  const firstEvents: FileSystemWatchEvent[] = []
  const secondEvents: FileSystemWatchEvent[] = []
  const childEvents: FileSystemWatchEvent[] = []
  hub.watch(firstParent, (event) => firstEvents.push(event))
  hub.watch(secondParent, (event) => secondEvents.push(event))
  hub.watch(child, (event) => childEvents.push(event))

  hub.batch(() => {
    hub.emit({ type: "created", ref: child, entryId: "same-local-id", newParent: firstParent })
    hub.emit({ type: "created", ref: child, entryId: "same-local-id", newParent: secondParent })
  })

  assert.equal(firstEvents.length, 1)
  assert.equal(firstEvents[0]?.newParent?.fileId, "first-parent")
  assert.equal(secondEvents.length, 1)
  assert.equal(secondEvents[0]?.newParent?.fileId, "second-parent")
  assert.deepEqual(
    childEvents[0]?.changes?.map((event) => event.newParent?.fileId),
    ["first-parent", "second-parent"],
  )
})

test("FileSystemWatchEventHub clears post-change parent and version on a coalesced delete", () => {
  const hub = new FileSystemWatchEventHub()
  const parent: FileRef = { fileSystemId: "watch-hub", fileId: "parent" }
  const child: FileRef = { fileSystemId: "watch-hub", fileId: "child" }
  const events: FileSystemWatchEvent[] = []
  hub.watch(parent, (event) => events.push(event))

  hub.batch(() => {
    hub.emit({
      type: "created",
      ref: child,
      entryId: "entry",
      newParent: parent,
      version: "created-version",
    })
    hub.emit({ type: "deleted", ref: child, entryId: "entry", oldParent: parent })
  })

  assert.equal(events.length, 1)
  assert.equal(events[0]?.type, "deleted")
  assert.equal(events[0]?.oldParent?.fileId, "parent")
  assert.equal(events[0]?.newParent, undefined)
  assert.equal(events[0]?.version, undefined)
})

test("FileSystemWatchEventHub unwraps nested change envelopes before routing and merging", () => {
  const hub = new FileSystemWatchEventHub()
  const parent: FileRef = { fileSystemId: "watch-hub", fileId: "parent" }
  const first: FileRef = { fileSystemId: "watch-hub", fileId: "first" }
  const second: FileRef = { fileSystemId: "watch-hub", fileId: "second" }
  const parentEvents: FileSystemWatchEvent[] = []
  const childEvents: FileSystemWatchEvent[] = []
  hub.watch(parent, (event) => parentEvents.push(event))
  hub.watch(first, (event) => childEvents.push(event))

  hub.emit({
    type: "changed",
    ref: parent,
    changes: [
      {
        type: "changed",
        ref: parent,
        changes: [
          { type: "created", ref: first, entryId: "first", newParent: parent, version: "1" },
          { type: "changed", ref: first, entryId: "first", newParent: parent, version: "2" },
        ],
      },
      { type: "created", ref: second, entryId: "second", newParent: parent },
    ],
  })

  assert.equal(parentEvents.length, 1)
  assert.deepEqual(
    parentEvents[0]?.changes?.map((event) => [event.type, event.ref.fileId, event.version]),
    [
      ["created", "first", "2"],
      ["created", "second", undefined],
    ],
  )
  assert.deepEqual(
    childEvents.map((event) => [event.type, event.ref.fileId, event.version]),
    [["created", "first", "2"]],
  )
})
