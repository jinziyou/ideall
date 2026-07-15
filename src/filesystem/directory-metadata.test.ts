import { test } from "node:test"
import assert from "node:assert/strict"
import type { DirectoryEntry, FileRef, IdeallFile } from "@protocol/file-system"
import { clearFileMetadataCacheForTest, rememberFileMetadata } from "./metadata-cache"
import { projectDirectoryEntryMetadata, resolveDirectoryEntryMetadata } from "./directory-metadata"
import { registerFileSystem } from "./registry"
import type { FileSystemProvider } from "./types"

const ctx = { actor: "ui", permissions: [], intent: "metadata" } as const

function file(ref: FileRef, name = ref.fileId): IdeallFile {
  return {
    ref,
    kind: "file",
    name,
    mediaType: "text/plain",
    capabilities: ["read"],
    source: { kind: "local", id: ref.fileSystemId },
  }
}

function entry(parent: FileRef, target: FileRef, embedded?: IdeallFile): DirectoryEntry {
  return {
    entryId: target.fileId,
    parent,
    target,
    name: target.fileId,
    kind: "child",
    ...(embedded ? { file: embedded } : {}),
  }
}

test("directory metadata: uses embedded/cache values and batches remaining refs by provider", async () => {
  clearFileMetadataCacheForTest()
  const fileSystemId = "test.directory-metadata"
  const parent = { fileSystemId, fileId: "root" }
  const refs = ["embedded", "cached", "missing"].map((fileId) => ({ fileSystemId, fileId }))
  const files = refs.map((ref) => file(ref))
  let nativeBatches = 0
  const provider: FileSystemProvider = {
    descriptor: {
      fileSystemId,
      name: "Directory metadata fixture",
      root: parent,
      source: { kind: "local", id: fileSystemId },
    },
    async stat(ref) {
      return files.find((candidate) => same(candidate.ref, ref)) ?? null
    },
    async statMany(requested) {
      nativeBatches += 1
      return requested.map((ref) => files.find((candidate) => same(candidate.ref, ref)) ?? null)
    },
    async readDirectory() {
      return { entries: [] }
    },
    async read() {
      return { data: "", mediaType: "text/plain" }
    },
    async write() {
      return files[0]!
    },
    async actions() {
      return []
    },
    async invoke() {
      return null
    },
  }
  const unregister = registerFileSystem(provider)
  try {
    rememberFileMetadata(files[1]!)
    const projected = projectDirectoryEntryMetadata([
      entry(parent, refs[0]!, files[0]),
      entry(parent, refs[1]!),
      entry(parent, refs[2]!),
    ])
    assert.deepEqual(
      projected.map((item) => item.file?.name ?? null),
      ["embedded", "cached", null],
    )

    let progress = 0
    const resolved = await resolveDirectoryEntryMetadata(projected, ctx, () => progress++)
    assert.deepEqual(
      resolved.map((item) => item.file?.name ?? null),
      ["embedded", "cached", "missing"],
    )
    assert.equal(nativeBatches, 1)
    assert.equal(progress, 1)
  } finally {
    unregister()
    clearFileMetadataCacheForTest()
  }
})

function same(left: FileRef, right: FileRef): boolean {
  return left.fileSystemId === right.fileSystemId && left.fileId === right.fileId
}
