import { test } from "node:test"
import assert from "node:assert/strict"
import type { FileRef, IdeallFile } from "@protocol/file-system"
import { registerFileSystem, replaceFileSystem } from "./registry"
import type { FileSystemProvider } from "./types"
import {
  cachedFileMetadata,
  clearFileMetadataCacheForTest,
  rememberFileMetadata,
  statFileCached,
} from "./metadata-cache"

const ctx = { actor: "ui", permissions: [], intent: "metadata" } as const

function fixtureProvider(fileSystemId: string, name: string, onStat?: () => void) {
  const ref: FileRef = { fileSystemId, fileId: "root" }
  const file: IdeallFile = {
    ref,
    kind: "file",
    name,
    mediaType: "text/plain",
    capabilities: ["read"],
    source: { kind: "local", id: fileSystemId },
  }
  const provider: FileSystemProvider = {
    descriptor: {
      fileSystemId,
      name,
      root: ref,
      source: file.source,
    },
    async stat(target) {
      onStat?.()
      return target.fileId === ref.fileId ? file : null
    },
    async readDirectory() {
      return { entries: [] }
    },
    async read() {
      return { data: "", mediaType: "text/plain" }
    },
    async write() {
      return file
    },
    async actions() {
      return []
    },
    async invoke() {
      return null
    },
  }
  return { ref, file, provider }
}

test("metadata cache: navigation metadata is reused and concurrent refreshes are deduplicated", async () => {
  clearFileMetadataCacheForTest()
  let stats = 0
  const fixture = fixtureProvider("test.metadata-cache", "cached.txt", () => stats++)
  const unregister = registerFileSystem(fixture.provider)
  try {
    rememberFileMetadata(fixture.file)
    assert.equal(cachedFileMetadata(fixture.ref), fixture.file)
    assert.equal(await statFileCached(fixture.ref, ctx), fixture.file)
    assert.equal(stats, 0)

    const [first, second] = await Promise.all([
      statFileCached(fixture.ref, ctx, { refresh: true }),
      statFileCached(fixture.ref, ctx, { refresh: true }),
    ])
    assert.equal(first, fixture.file)
    assert.equal(second, fixture.file)
    assert.equal(stats, 1)
  } finally {
    unregister()
    clearFileMetadataCacheForTest()
  }
})

test("metadata cache: replacing a provider invalidates the previous generation", () => {
  clearFileMetadataCacheForTest()
  const first = fixtureProvider("test.metadata-replace", "old.txt")
  const second = fixtureProvider("test.metadata-replace", "new.txt")
  const unregisterFirst = registerFileSystem(first.provider)
  rememberFileMetadata(first.file)
  assert.equal(cachedFileMetadata(first.ref)?.name, "old.txt")

  const unregisterSecond = replaceFileSystem(second.provider)
  try {
    assert.equal(cachedFileMetadata(first.ref), null)
  } finally {
    unregisterSecond()
    unregisterFirst()
    clearFileMetadataCacheForTest()
  }
})
