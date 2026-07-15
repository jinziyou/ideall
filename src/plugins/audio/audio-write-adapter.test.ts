import assert from "node:assert/strict"
import { test } from "node:test"
import type { FileRef } from "@protocol/file-system"
import { AUDIO_LIBRARY_ROOT_REF } from "@/filesystem/builtin-app-roots"
import { audioTrackRef, createAudioFileSystem } from "./audio-file-system"
import type { AudioTrack } from "./audio-store"
import {
  importAudioLibraryJsonWithRootLock,
  withAudioLibraryRootMutationLock,
} from "./audio-write-adapter"
import { audioManifest } from "./manifest"

const UI_WRITE = { actor: "ui", permissions: [], intent: "write" } as const
const UI_ACTION = { actor: "ui", permissions: [], intent: "action" } as const
const UI_WATCH = { actor: "ui", permissions: [], intent: "watch" } as const

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function track(id: string, title = id, updatedAt = 10): AudioTrack {
  return {
    id,
    title,
    mime: "audio/wav",
    size: 4,
    blob: new Blob(["wave"], { type: "audio/wav" }),
    createdAt: 1,
    updatedAt,
  }
}

test("audio write adapter: manifest import serializes every provider mutation on the root lock", async () => {
  const events: string[] = []
  const manifestEntered = deferred()
  const releaseManifest = deferred()
  const current = track("current")
  const provider = createAudioFileSystem({
    async addTrack() {
      events.push("provider:add")
      return track("added")
    },
    async importLibrary() {
      events.push("provider:import")
      return { tracks: 1 }
    },
    async listTracks() {
      return [current]
    },
    async removeTrack() {
      events.push("provider:delete")
    },
    async savePlayback() {
      events.push("provider:playback")
    },
    async updateTrack(_id, patch) {
      events.push("provider:update")
      return { ...current, ...patch, updatedAt: current.updatedAt + 1 }
    },
  })

  const manifestImport = importAudioLibraryJsonWithRootLock("audio-package", async (raw) => {
    assert.equal(raw, "audio-package")
    events.push("manifest:start")
    manifestEntered.resolve()
    await releaseManifest.promise
    events.push("manifest:end")
    return { tracks: 2 }
  })
  await manifestEntered.promise

  const providerMutations = [
    provider.write(
      provider.descriptor.root,
      {
        data: {
          currentTrackId: current.id,
          currentTime: 0,
          volume: 1,
          repeat: "none",
          shuffle: false,
        },
      },
      UI_WRITE,
    ),
    provider.invoke(
      provider.descriptor.root,
      "add-track",
      new File(["wave"], "added.wav", { type: "audio/wav" }),
      UI_ACTION,
    ),
    provider.invoke(provider.descriptor.root, "import", "provider-package", UI_ACTION),
    provider.write(
      audioTrackRef(current.id),
      { data: { title: "updated" }, expectedVersion: "10" },
      UI_WRITE,
    ),
    provider.invoke(audioTrackRef(current.id), "delete", undefined, UI_ACTION, {
      expectedVersion: "10",
    }),
  ]
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.deepEqual(events, ["manifest:start"], "provider mutations must wait for manifest import")

  releaseManifest.resolve()
  const [importResult] = await Promise.all([manifestImport, ...providerMutations])

  assert.deepEqual(importResult, { tracks: 2 })
  assert.deepEqual(events.slice(0, 2), ["manifest:start", "manifest:end"])
  assert.deepEqual(
    new Set(events.slice(2)),
    new Set([
      "provider:playback",
      "provider:add",
      "provider:import",
      "provider:update",
      "provider:delete",
    ]),
  )
})

test("audio write adapter: uses the canonical library root lock", async () => {
  let lockedRef: FileRef | undefined
  await withAudioLibraryRootMutationLock(
    () => undefined,
    async (ref, operation) => {
      lockedRef = ref
      return operation()
    },
  )
  assert.deepEqual(lockedRef, AUDIO_LIBRARY_ROOT_REF)
})

test("audio data-port import invalidates open root and track displays only after success", async () => {
  const provider = createAudioFileSystem({
    async addTrack(file) {
      return track("added", file.name)
    },
    async importLibrary() {
      return { tracks: 0 }
    },
    async listTracks() {
      return []
    },
    async removeTrack() {},
    async savePlayback() {},
    async updateTrack(id, patch) {
      return { ...track(id), ...patch }
    },
  })
  const trackRef = audioTrackRef("track")
  const rootEvents: string[] = []
  const trackEvents: string[] = []
  const rootWatch = provider.watch?.(AUDIO_LIBRARY_ROOT_REF, UI_WATCH, (event) =>
    rootEvents.push(`${event.type}:${event.ref.fileId}`),
  )
  const trackWatch = provider.watch?.(trackRef, UI_WATCH, (event) =>
    trackEvents.push(`${event.type}:${event.ref.fileId}`),
  )
  assert.ok(rootWatch)
  assert.ok(trackWatch)

  const result = await importAudioLibraryJsonWithRootLock("audio-package", async () => ({
    tracks: 1,
  }))
  assert.deepEqual(result, { tracks: 1 })
  assert.deepEqual(rootEvents, [`changed:${AUDIO_LIBRARY_ROOT_REF.fileId}`])
  assert.deepEqual(trackEvents, [`changed:${trackRef.fileId}`])

  await assert.rejects(
    importAudioLibraryJsonWithRootLock("broken-package", async () => {
      throw new Error("audio import rejected")
    }),
    /audio import rejected/,
  )
  assert.equal(rootEvents.length, 1)
  assert.equal(trackEvents.length, 1)

  rootWatch.dispose()
  trackWatch.dispose()
})

test("audio manifest: importJson routes through the root lock adapter", () => {
  assert.equal(audioManifest.dataPorts[0]?.importJson, importAudioLibraryJsonWithRootLock)
})
