import { test } from "node:test"
import assert from "node:assert/strict"
import type { FileRef } from "@protocol/file-system"
import { registerFileSystem } from "./registry"
import type { FileSystemProvider } from "./types"
import { FileSystemError } from "./types"
import { watchFileSet } from "./watch-set"

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
