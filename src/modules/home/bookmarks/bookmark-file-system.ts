import type { Bookmark, BookmarkFolder, NewBookmark } from "@protocol/files"
import type { NodeOfKind } from "@protocol/node"
import { isFileRef, sameFileRef, type FileRef, type IdeallFile } from "@protocol/file-system"
import { corePlaceRef } from "@/filesystem/resource-file-system"
import { walkFileDirectory } from "@/filesystem/directory-walk"
import { invokeFileAction, readFile } from "@/filesystem/registry"
import type { FileSystemAccessContext } from "@/filesystem/types"

export type FileBookmark = Bookmark & { ref: FileRef; version: string | null }
export type FileBookmarkFolder = BookmarkFolder & { ref: FileRef; version: string | null }

const BOOKMARKS_ROOT = corePlaceRef("bookmarks")
const READ_CONTEXT = {
  actor: "ui",
  permissions: [],
  intent: "content",
} as const satisfies FileSystemAccessContext
const ACTION_CONTEXT = {
  actor: "ui",
  permissions: [],
  intent: "action",
} as const satisfies FileSystemAccessContext

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function bookmarkNode(value: unknown): NodeOfKind<"bookmark"> | null {
  if (!isRecord(value) || value.kind !== "bookmark" || !isRecord(value.content)) return null
  if (
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    typeof value.createdAt !== "number" ||
    !isStringArray(value.tags) ||
    typeof value.content.url !== "string"
  ) {
    return null
  }
  return value as unknown as NodeOfKind<"bookmark">
}

function folderNode(value: unknown): NodeOfKind<"folder"> | null {
  if (
    !isRecord(value) ||
    value.kind !== "folder" ||
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    typeof value.createdAt !== "number"
  ) {
    return null
  }
  return value as unknown as NodeOfKind<"folder">
}

function createdFile(value: unknown): IdeallFile {
  if (!isRecord(value) || !isFileRef(value.ref) || !isRecord(value.file)) {
    throw new Error("文件系统未返回新建文件")
  }
  const file = value.file as Partial<IdeallFile>
  if (!isFileRef(file.ref) || typeof file.name !== "string") {
    throw new Error("文件系统返回了无效的新建文件")
  }
  return file as IdeallFile
}

export async function listBookmarkFiles(): Promise<{
  folders: FileBookmarkFolder[]
  bookmarks: FileBookmark[]
}> {
  const entries = await walkFileDirectory(
    BOOKMARKS_ROOT,
    { ...READ_CONTEXT, intent: "directory" },
    (entry) => entry.properties?.resourceKind === "folder",
  )
  const loaded = await Promise.all(
    entries
      .filter((entry) => ["folder", "bookmark"].includes(String(entry.properties?.resourceKind)))
      .map(async (entry) => {
        const result = await readFile(entry.target, READ_CONTEXT, { encoding: "json" })
        const snapshotVersion =
          entry.file && sameFileRef(entry.file.ref, entry.target) ? entry.file.version : undefined
        return {
          entry,
          data: result.data,
          version: result.version ?? snapshotVersion ?? null,
        }
      }),
  )
  const folders: FileBookmarkFolder[] = []
  const bookmarks: FileBookmark[] = []
  for (const { entry, data, version } of loaded) {
    const folder = folderNode(data)
    if (folder) {
      folders.push({
        id: folder.id,
        name: folder.title,
        createdAt: folder.createdAt,
        ref: entry.target,
        version,
      })
      continue
    }
    const bookmark = bookmarkNode(data)
    if (!bookmark) continue
    bookmarks.push({
      id: bookmark.id,
      title: bookmark.title,
      url: bookmark.content.url,
      description: bookmark.content.description ?? "",
      favicon: bookmark.content.favicon ?? "",
      folderId: bookmark.parentId,
      tags: bookmark.tags,
      createdAt: bookmark.createdAt,
      ref: entry.target,
      version,
    })
  }
  folders.sort((left, right) => left.createdAt - right.createdAt)
  bookmarks.sort((left, right) => right.createdAt - left.createdAt)
  return { folders, bookmarks }
}

export async function createBookmarkFolder(name: string): Promise<FileBookmarkFolder> {
  const file = createdFile(
    await invokeFileAction(
      BOOKMARKS_ROOT,
      "create",
      { kind: "folder", title: name.trim() || "未命名收藏夹" },
      ACTION_CONTEXT,
    ),
  )
  const result = await readFile(file.ref, READ_CONTEXT, { encoding: "json" })
  const data = folderNode(result.data)
  if (!data) throw new Error("文件系统返回了无效的收藏夹")
  return {
    id: data.id,
    name: data.title,
    createdAt: data.createdAt,
    ref: file.ref,
    version: result.version ?? file.version ?? null,
  }
}

export async function renameBookmarkFolder(
  folder: FileBookmarkFolder,
  name: string,
): Promise<void> {
  await invokeFileAction(folder.ref, "edit", { title: name }, ACTION_CONTEXT, {
    expectedVersion: folder.version,
  })
}

export async function deleteBookmarkFolder(folder: FileBookmarkFolder): Promise<void> {
  await invokeFileAction(folder.ref, "delete", undefined, ACTION_CONTEXT, {
    expectedVersion: folder.version,
  })
}

export async function createBookmarkFile(
  input: NewBookmark,
  folder: FileBookmarkFolder | null,
): Promise<void> {
  await invokeFileAction(
    folder?.ref ?? BOOKMARKS_ROOT,
    "create",
    {
      kind: "bookmark",
      title: input.title,
      tags: input.tags ?? [],
      content: {
        url: input.url,
        description: input.description ?? "",
        favicon: input.favicon ?? "",
      },
    },
    ACTION_CONTEXT,
  )
}

export async function updateBookmarkFile(
  bookmark: FileBookmark,
  patch: Omit<NewBookmark, "folderId"> & { folder: FileBookmarkFolder | null },
): Promise<void> {
  const parentId = patch.folder?.id ?? null
  // Resource Node 的 edit 可在同一 Storage 事务内同时更新 parent 与字段；避免
  // move 已提交、后续 edit 冲突时留下半完成的用户操作。
  await invokeFileAction(
    bookmark.ref,
    "edit",
    {
      ...(bookmark.folderId === parentId ? {} : { parentId }),
      title: patch.title,
      tags: patch.tags ?? [],
      content: {
        url: patch.url,
        description: patch.description ?? "",
        favicon: patch.favicon ?? bookmark.favicon,
      },
    },
    ACTION_CONTEXT,
    { expectedVersion: bookmark.version },
  )
}

export async function moveBookmarkFile(
  bookmark: FileBookmark,
  folder: FileBookmarkFolder | null,
): Promise<void> {
  await invokeFileAction(bookmark.ref, "move", { parentId: folder?.id ?? null }, ACTION_CONTEXT, {
    expectedVersion: bookmark.version,
  })
}

export async function deleteBookmarkFile(bookmark: FileBookmark): Promise<void> {
  await invokeFileAction(bookmark.ref, "delete", undefined, ACTION_CONTEXT, {
    expectedVersion: bookmark.version,
  })
}

export async function restoreBookmarkFile(bookmark: FileBookmark): Promise<void> {
  await invokeFileAction(bookmark.ref, "restore", undefined, ACTION_CONTEXT)
}
