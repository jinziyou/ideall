import { test } from "node:test"
import assert from "node:assert/strict"
import { DIRECTORY_MEDIA_TYPE, type FileRef, type IdeallFile } from "@protocol/file-system"
import { FileSystemRegistry } from "./registry"
import {
  ideallPathSegments,
  joinIdeallPath,
  normalizeIdeallPath,
  resolveFileSystemPath,
} from "./path"
import { FileSystemError, type FileSystemAccessContext, type FileSystemProvider } from "./types"

const ctx: FileSystemAccessContext = { actor: "ui", permissions: [] }

function file(ref: FileRef, kind: IdeallFile["kind"], name: string): IdeallFile {
  return {
    ref,
    kind,
    name,
    mediaType: kind === "directory" ? DIRECTORY_MEDIA_TYPE : "text/plain",
    capabilities: kind === "directory" ? ["read-directory"] : ["read"],
    source: { kind: "system", id: ref.fileSystemId },
  }
}

function provider(
  fileSystemId: string,
  files: readonly IdeallFile[],
  directories: Readonly<
    Record<string, Array<{ entryId?: string; pathName: string; target: FileRef }>>
  >,
): FileSystemProvider {
  const byId = new Map(files.map((item) => [item.ref.fileId, item]))
  const root = files[0]!.ref
  return {
    descriptor: {
      fileSystemId,
      root,
      name: fileSystemId,
      source: { kind: "system", id: fileSystemId },
    },
    async stat(ref) {
      return byId.get(ref.fileId) ?? null
    },
    async readDirectory(ref, _ctx, options = {}) {
      const all = directories[ref.fileId] ?? []
      const offset = Number(options.cursor ?? 0)
      const limit = options.limit ?? all.length
      const items = all.slice(offset, offset + limit)
      return {
        entries: items.map((item) => ({
          entryId: item.entryId ?? item.pathName,
          pathName: item.pathName,
          name: item.pathName,
          parent: ref,
          target: item.target,
          kind: "link" as const,
        })),
        nextCursor: offset + items.length < all.length ? String(offset + items.length) : undefined,
      }
    },
    async read(ref) {
      throw new FileSystemError("unsupported", "not readable", ref)
    },
    async write(ref) {
      throw new FileSystemError("unsupported", "not writable", ref)
    },
    async actions() {
      return []
    },
    async invoke(ref) {
      throw new FileSystemError("unsupported", "no actions", ref)
    },
  }
}

test("ideall path: 规范化绝对路径且拒绝越过隐藏根", () => {
  assert.equal(normalizeIdeallPath("//home/./bookmarks/../files"), "/home/files")
  assert.deepEqual(ideallPathSegments("/home/files"), ["home", "files"])
  assert.equal(joinIdeallPath("/home", "bookmarks"), "/home/bookmarks")
  assert.throws(() => normalizeIdeallPath("home"), FileSystemError)
  assert.throws(() => normalizeIdeallPath("/../home"), FileSystemError)
  assert.throws(() => joinIdeallPath("/home", "a/b"), FileSystemError)
})

test("ideall path: 跨 FileSystem 跟随目录 link，但保留 target 的 FileRef 身份", async () => {
  const registry = new FileSystemRegistry()
  const rootRef = { fileSystemId: "root", fileId: "root" }
  const homeRef = { fileSystemId: "navigation", fileId: "home" }
  const bookmarkRef = { fileSystemId: "core", fileId: "bookmark-panel" }
  registry.register(
    provider("root", [file(rootRef, "directory", "root")], {
      root: [{ pathName: "home", target: homeRef }],
    }),
  )
  registry.register(
    provider("navigation", [file(homeRef, "directory", "home")], {
      home: [{ pathName: "bookmarks", target: bookmarkRef }],
    }),
  )
  registry.register(provider("core", [file(bookmarkRef, "file", "书签")], {}))

  const resolved = await resolveFileSystemPath(registry, rootRef, "/home/bookmarks", ctx)
  assert.deepEqual(resolved?.ref, bookmarkRef)
  assert.equal(resolved?.file.name, "书签")
  assert.deepEqual(
    resolved?.entries.map((entry) => entry.pathName),
    ["home", "bookmarks"],
  )
  assert.equal(await resolveFileSystemPath(registry, rootRef, "/home/missing", ctx), null)
})

test("ideall path: 同一目录重复 pathName 时拒绝不确定解析", async () => {
  const registry = new FileSystemRegistry()
  const rootRef = { fileSystemId: "root", fileId: "root" }
  const target = { fileSystemId: "root", fileId: "target" }
  registry.register(
    provider("root", [file(rootRef, "directory", "root"), file(target, "file", "target")], {
      root: [
        { entryId: "same-a", pathName: "same", target },
        { entryId: "same-b", pathName: "same", target },
      ],
    }),
  )

  await assert.rejects(
    () => resolveFileSystemPath(registry, rootRef, "/same", ctx),
    (error) => error instanceof FileSystemError && error.code === "conflict",
  )
})
