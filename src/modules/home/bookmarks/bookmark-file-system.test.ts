import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import {
  DIRECTORY_MEDIA_TYPE,
  sameFileRef,
  type DirectoryEntry,
  type FileRef,
  type IdeallFile,
} from "@protocol/file-system"
import type { NodeOfKind } from "@protocol/node"
import { corePlaceRef, resourceFileRef } from "@/filesystem/resource-file-system"
import { clearFileSystemsForTest, registerFileSystem } from "@/filesystem/registry"
import type { FileActionInvokeOptions, FileSystemProvider } from "@/filesystem/types"
import {
  createBookmarkFile,
  createBookmarkFolder,
  deleteBookmarkFile,
  deleteBookmarkFolder,
  listBookmarkFiles,
  moveBookmarkFile,
  renameBookmarkFolder,
  restoreBookmarkFile,
  updateBookmarkFile,
} from "./bookmark-file-system"

type Invocation = {
  ref: FileRef
  action: string
  input: unknown
  options: FileActionInvokeOptions | undefined
}

const BOOKMARKS_ROOT = corePlaceRef("bookmarks")
const folderRef = resourceFileRef({ scheme: "node", kind: "folder", id: "folder-1" })
const bookmarkRef = resourceFileRef({ scheme: "node", kind: "bookmark", id: "bookmark-1" })
const createdFolderRef = resourceFileRef({ scheme: "node", kind: "folder", id: "folder-created" })

function metadata(ref: FileRef, kind: IdeallFile["kind"], version?: string): IdeallFile {
  return {
    ref,
    kind,
    name: ref.fileId,
    mediaType: kind === "directory" ? DIRECTORY_MEDIA_TYPE : "application/json",
    capabilities: ["read", "actions"],
    source: { kind: "local", id: ref.fileSystemId },
    ...(version === undefined ? {} : { version }),
  }
}

function folderNode(id: string, createdAt: number): NodeOfKind<"folder"> {
  return {
    id,
    kind: "folder",
    parentId: null,
    sortKey: id,
    title: id,
    tags: [],
    createdAt,
    updatedAt: createdAt,
  }
}

function bookmarkNode(): NodeOfKind<"bookmark"> {
  return {
    id: "bookmark-1",
    kind: "bookmark",
    parentId: null,
    sortKey: "bookmark-1",
    title: "Bookmark",
    tags: ["tag"],
    createdAt: 20,
    updatedAt: 20,
    content: { url: "https://example.com", description: "before", favicon: "icon" },
  }
}

function fixture() {
  clearFileSystemsForTest()
  const rootEntries: DirectoryEntry[] = [
    {
      entryId: "folder-1",
      parent: BOOKMARKS_ROOT,
      target: folderRef,
      name: "Folder",
      kind: "child",
      file: metadata(folderRef, "directory", "folder-meta-v"),
      properties: { resourceKind: "folder" },
    },
    {
      entryId: "bookmark-1",
      parent: BOOKMARKS_ROOT,
      target: bookmarkRef,
      name: "Bookmark",
      kind: "child",
      file: metadata(bookmarkRef, "file", "stale-entry-v"),
      properties: { resourceKind: "bookmark" },
    },
  ]
  const invocations: Invocation[] = []
  const provider: FileSystemProvider = {
    descriptor: {
      fileSystemId: BOOKMARKS_ROOT.fileSystemId,
      name: "bookmarks fixture",
      root: { fileSystemId: BOOKMARKS_ROOT.fileSystemId, fileId: "fixture-root" },
      source: { kind: "local", id: "bookmarks-fixture" },
    },
    async stat(ref) {
      if (sameFileRef(ref, folderRef)) return metadata(ref, "directory", "folder-meta-v")
      if (sameFileRef(ref, bookmarkRef)) return metadata(ref, "file", "bookmark-read-v")
      if (sameFileRef(ref, createdFolderRef)) return metadata(ref, "directory", "created-file-v")
      return null
    },
    async readDirectory(ref) {
      if (sameFileRef(ref, BOOKMARKS_ROOT)) return { entries: rootEntries }
      if (sameFileRef(ref, folderRef)) return { entries: [] }
      throw new Error(`unexpected directory: ${ref.fileId}`)
    },
    async read(ref) {
      if (sameFileRef(ref, folderRef)) {
        return { data: folderNode("folder-1", 10), mediaType: "application/json" }
      }
      if (sameFileRef(ref, bookmarkRef)) {
        return {
          data: bookmarkNode(),
          mediaType: "application/json",
          version: "bookmark-read-v",
        }
      }
      if (sameFileRef(ref, createdFolderRef)) {
        return {
          data: folderNode("folder-created", 30),
          mediaType: "application/json",
          version: "created-read-v",
        }
      }
      throw new Error(`unexpected read: ${ref.fileId}`)
    },
    async write() {
      throw new Error("unexpected write")
    },
    async actions() {
      return []
    },
    async invoke(ref, action, input, _ctx, options) {
      invocations.push({ ref, action, input, options })
      if (action === "create" && sameFileRef(ref, BOOKMARKS_ROOT)) {
        return {
          ref: createdFolderRef,
          file: metadata(createdFolderRef, "directory", "created-file-v"),
        }
      }
      return null
    },
  }
  registerFileSystem(provider)
  return { invocations }
}

afterEach(clearFileSystemsForTest)

test("bookmark adapter: loaded and created files retain ReadResult/IdeallFile versions", async () => {
  const { invocations } = fixture()
  const loaded = await listBookmarkFiles()

  assert.equal(loaded.folders[0]?.version, "folder-meta-v")
  assert.equal(loaded.bookmarks[0]?.version, "bookmark-read-v")
  const created = await createBookmarkFolder("Created")
  assert.equal(created.version, "created-read-v")
  assert.deepEqual(
    invocations.map(({ action, options }) => ({ action, options })),
    [{ action: "create", options: undefined }],
  )
})

test("bookmark adapter: edit/move/delete use snapshots and combined updates stay atomic", async () => {
  const { invocations } = fixture()
  const { folders, bookmarks } = await listBookmarkFiles()
  const folder = folders[0]!
  const bookmark = bookmarks[0]!

  await createBookmarkFile({ title: "New", url: "https://new.example", description: "new" }, folder)
  await renameBookmarkFolder(folder, "Renamed")
  await deleteBookmarkFolder(folder)
  await updateBookmarkFile(bookmark, {
    title: "Edited",
    url: bookmark.url,
    description: bookmark.description,
    tags: bookmark.tags,
    folder: null,
  })
  await updateBookmarkFile(bookmark, {
    title: "Moved and edited",
    url: bookmark.url,
    description: bookmark.description,
    tags: bookmark.tags,
    folder,
  })
  await moveBookmarkFile(bookmark, folder)
  await deleteBookmarkFile(bookmark)
  await restoreBookmarkFile(bookmark)

  assert.deepEqual(
    invocations.map(({ action, options }) => ({ action, options })),
    [
      { action: "create", options: undefined },
      { action: "edit", options: { expectedVersion: "folder-meta-v" } },
      { action: "delete", options: { expectedVersion: "folder-meta-v" } },
      { action: "edit", options: { expectedVersion: "bookmark-read-v" } },
      { action: "edit", options: { expectedVersion: "bookmark-read-v" } },
      { action: "move", options: { expectedVersion: "bookmark-read-v" } },
      { action: "delete", options: { expectedVersion: "bookmark-read-v" } },
      { action: "restore", options: undefined },
    ],
  )
  assert.deepEqual(invocations[4]?.input, {
    parentId: folder.id,
    title: "Moved and edited",
    tags: bookmark.tags,
    content: {
      url: bookmark.url,
      description: bookmark.description,
      favicon: bookmark.favicon,
    },
  })
})

test("bookmark adapter: known unversioned snapshots use an explicit null precondition", async () => {
  const { invocations } = fixture()
  const { bookmarks } = await listBookmarkFiles()
  const bookmark = { ...bookmarks[0]!, version: null }

  await updateBookmarkFile(bookmark, {
    title: bookmark.title,
    url: bookmark.url,
    description: bookmark.description,
    tags: bookmark.tags,
    folder: null,
  })
  await moveBookmarkFile(bookmark, null)
  await deleteBookmarkFile(bookmark)

  assert.deepEqual(
    invocations.map(({ action, options }) => ({ action, options })),
    [
      { action: "edit", options: { expectedVersion: null } },
      { action: "move", options: { expectedVersion: null } },
      { action: "delete", options: { expectedVersion: null } },
    ],
  )
})
