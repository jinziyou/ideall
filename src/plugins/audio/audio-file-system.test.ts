import assert from "node:assert/strict"
import { test } from "node:test"
import { FileSystemError } from "@/filesystem/types"
import type { FileSystemWatchEvent } from "@/filesystem/types"
import { audioTrackRef, createAudioFileSystem } from "./audio-file-system"
import type { AudioTrack } from "./audio-store"

function track(id: string, title = id, updatedAt = 10): AudioTrack {
  return {
    id,
    title,
    mime: "audio/wav",
    size: 6,
    blob: new Blob(["abcdef"], { type: "audio/wav" }),
    createdAt: 1,
    updatedAt,
  }
}

test("audio filesystem: entry ids are stable and byte ranges are applied", async () => {
  let tracks = [track("a"), track("b")]
  const fs = createAudioFileSystem({
    async listTracks() {
      return tracks
    },
    async removeTrack() {},
    async updateTrack() {
      return null
    },
  })
  const directoryCtx = { actor: "ui", permissions: [], intent: "directory" } as const
  const first = await fs.readDirectory(fs.descriptor.root, directoryCtx)
  tracks = [...tracks].reverse()
  const second = await fs.readDirectory(fs.descriptor.root, directoryCtx)
  const ids = (page: typeof first) =>
    Object.fromEntries(page.entries.map((entry) => [entry.target.fileId, entry.entryId]))
  assert.deepEqual(ids(second), ids(first))

  const ref = first.entries[0].target
  const result = await fs.read(
    ref,
    { actor: "engine", permissions: [], activeFile: ref, intent: "content" },
    { range: { start: 1, end: 4 } },
  )
  assert.equal(await (result.data as Blob).text(), "bcd")
  assert.equal(result.size, 3)
  assert.equal(result.version, "10")
  await assert.rejects(
    fs.read(ref, { actor: "ui", permissions: [], intent: "content" }, { range: { start: -1 } }),
    (error) => error instanceof FileSystemError && error.code === "invalid-input",
  )
})

test("audio filesystem: stat returns null for a missing track while reads stay strict", async () => {
  const fs = createAudioFileSystem({
    async listTracks() {
      return []
    },
  })
  const missing = audioTrackRef("missing")

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

test("audio filesystem: writes enforce actor scope, intent and expectedVersion", async () => {
  let current = track("a")
  let updates = 0
  const fs = createAudioFileSystem({
    async listTracks() {
      return [current]
    },
    async removeTrack() {},
    async updateTrack(_id, patch) {
      updates++
      current = { ...current, ...patch, updatedAt: current.updatedAt + 1 }
      return current
    },
  })
  const ref = (
    await fs.readDirectory(fs.descriptor.root, {
      actor: "ui",
      permissions: [],
      intent: "directory",
    })
  ).entries[0].target

  await assert.rejects(
    fs.write(
      ref,
      { data: { title: "stale" }, expectedVersion: "9" },
      { actor: "system", permissions: ["fs:write"], intent: "write" },
    ),
    (error) => error instanceof FileSystemError && error.code === "conflict",
  )
  assert.equal(updates, 0)
  await assert.rejects(
    fs.write(
      ref,
      { data: { title: "blocked" } },
      {
        actor: "system",
        permissions: [],
        intent: "write",
      },
    ),
    (error) => error instanceof FileSystemError && error.code === "permission-denied",
  )
  await fs.write(
    ref,
    { data: { title: "updated" }, expectedVersion: "10" },
    { actor: "engine", permissions: [], activeFile: ref, intent: "write" },
  )
  assert.equal(current.title, "updated")
  assert.equal(updates, 1)
})

test("audio filesystem: concurrent writes atomically enforce a shared expectedVersion", async () => {
  let current = track("a", "base")
  const fs = createAudioFileSystem({
    async listTracks() {
      return [current]
    },
    async updateTrack(_id, patch) {
      await new Promise((resolve) => setTimeout(resolve, 5))
      current = { ...current, ...patch, updatedAt: current.updatedAt + 1 }
      return current
    },
  })
  const ref = audioTrackRef(current.id)
  const writeCtx = { actor: "system", permissions: ["fs:write"], intent: "write" } as const
  const results = await Promise.allSettled(
    ["first", "second"].map(async (candidate) => {
      await fs.write(ref, { data: { title: candidate }, expectedVersion: "10" }, writeCtx)
      return candidate
    }),
  )
  const fulfilled = results.filter(
    (result): result is PromiseFulfilledResult<string> => result.status === "fulfilled",
  )
  const rejected = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  )

  assert.equal(fulfilled.length, 1)
  assert.equal(rejected.length, 1)
  assert.ok(rejected[0].reason instanceof FileSystemError)
  assert.equal(rejected[0].reason.code, "conflict")
  assert.equal(current.title, fulfilled[0].value)
  assert.equal(current.updatedAt, 11)
})

test("audio filesystem: root watch receives parent-scoped incremental track events", async () => {
  let tracks = [track("linked")]
  const fs = createAudioFileSystem({
    async listTracks() {
      return tracks
    },
    async updateTrack(id, patch) {
      const current = tracks.find((item) => item.id === id)
      if (!current) return null
      const updated = { ...current, ...patch, updatedAt: current.updatedAt + 1 }
      tracks = tracks.map((item) => (item.id === id ? updated : item))
      return updated
    },
    async removeTrack(id) {
      tracks = tracks.filter((item) => item.id !== id)
    },
  })
  const ref = audioTrackRef("linked")
  const rootEvents: FileSystemWatchEvent[] = []
  const trackEvents: FileSystemWatchEvent[] = []
  const rootWatch = fs.watch?.(
    fs.descriptor.root,
    { actor: "ui", permissions: [], intent: "watch" },
    (event) => rootEvents.push(event),
  )
  const trackWatch = fs.watch?.(ref, { actor: "ui", permissions: [], intent: "watch" }, (event) =>
    trackEvents.push(event),
  )

  await fs.write(
    ref,
    { data: { title: "next" }, expectedVersion: "10" },
    { actor: "ui", permissions: [], intent: "write" },
  )
  await fs.invoke(ref, "delete", undefined, {
    actor: "ui",
    permissions: [],
    intent: "action",
  })

  assert.deepEqual(
    rootEvents.map((event) => ({
      type: event.type,
      entryId: event.entryId,
      oldParent: event.oldParent?.fileId,
      newParent: event.newParent?.fileId,
      version: event.version,
    })),
    [
      {
        type: "changed",
        entryId: "linked",
        oldParent: undefined,
        newParent: "root",
        version: "11",
      },
      {
        type: "deleted",
        entryId: "linked",
        oldParent: "root",
        newParent: undefined,
        version: undefined,
      },
    ],
  )
  assert.deepEqual(
    trackEvents.map((event) => event.type),
    ["changed", "deleted"],
  )
  rootWatch?.dispose()
  trackWatch?.dispose()
})

test("audio filesystem: deleting requires write permission and never trusts active engine alone", async () => {
  const current = track("a")
  let removed = false
  const fs = createAudioFileSystem({
    async listTracks() {
      return [current]
    },
    async removeTrack() {
      removed = true
    },
    async updateTrack() {
      return null
    },
  })
  const ref = (
    await fs.readDirectory(fs.descriptor.root, {
      actor: "ui",
      permissions: [],
      intent: "directory",
    })
  ).entries[0].target

  await assert.rejects(
    fs.invoke(ref, "delete", null, {
      actor: "engine",
      permissions: [],
      activeFile: ref,
      intent: "action",
    }),
    (error) => error instanceof FileSystemError && error.code === "permission-denied",
  )
  assert.equal(removed, false)
  await fs.invoke(ref, "delete", null, {
    actor: "system",
    permissions: ["fs:write"],
    intent: "action",
  })
  assert.equal(removed, true)
  assert.equal(fs.descriptor.capabilities?.includes("watch"), true)
})

test("audio filesystem: delete actions enforce the fresh track expectedVersion", async () => {
  const current = track("versioned")
  const removed: string[] = []
  const fs = createAudioFileSystem({
    async listTracks() {
      return [current]
    },
    async removeTrack(id) {
      removed.push(id)
    },
  })
  const ref = audioTrackRef(current.id)
  const actionCtx = { actor: "ui", permissions: [], intent: "action" } as const

  await assert.rejects(
    fs.invoke(ref, "delete", undefined, actionCtx, { expectedVersion: "9" }),
    (error) => error instanceof FileSystemError && error.code === "conflict",
  )
  await assert.rejects(
    fs.invoke(ref, "delete", undefined, actionCtx, { expectedVersion: null }),
    (error) => error instanceof FileSystemError && error.code === "conflict",
  )
  assert.deepEqual(removed, [])

  await fs.invoke(ref, "delete", undefined, actionCtx, { expectedVersion: "10" })
  await fs.invoke(ref, "delete", undefined, actionCtx)
  assert.deepEqual(removed, [current.id, current.id])
})
