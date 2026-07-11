import {
  DIRECTORY_MEDIA_TYPE,
  fileRefKey,
  sameFileRef,
  type FileRef,
  type IdeallFile,
} from "@protocol/file-system"
import { onFilesUpdated } from "@protocol/flowback"
import {
  emptyTrash,
  listTrashItems,
  purgeTrashItem,
  type TrashItem,
} from "@/files/stores/trash-store"
import { restoreNode } from "@/files/stores/nodes-store"
import type {
  DirectoryPage,
  FileAction,
  FileReadResult,
  FileSystemAccessContext,
  FileSystemProvider,
  FileSystemWatchHandle,
  ReadDirectoryOptions,
} from "./types"
import { FileSystemError } from "./types"

export type TrashFileItem = TrashItem

export type TrashFileSystemDeps = {
  empty: typeof emptyTrash
  list: typeof listTrashItems
  purge: typeof purgeTrashItem
  restore: typeof restoreNode
  onUpdated: typeof onFilesUpdated
}

const defaultDeps: TrashFileSystemDeps = {
  empty: emptyTrash,
  list: listTrashItems,
  purge: purgeTrashItem,
  restore: restoreNode,
  onUpdated: onFilesUpdated,
}

export const TRASH_FILE_SYSTEM_ID = "ideall.trash"
export const trashRootRef: FileRef = { fileSystemId: TRASH_FILE_SYSTEM_ID, fileId: "root" }

export function trashItemRef(id: string): FileRef {
  return { fileSystemId: TRASH_FILE_SYSTEM_ID, fileId: `item:${encodeURIComponent(id)}` }
}

function itemId(ref: FileRef): string | null {
  if (ref.fileSystemId !== TRASH_FILE_SYSTEM_ID || !ref.fileId.startsWith("item:")) return null
  try {
    return decodeURIComponent(ref.fileId.slice("item:".length)) || null
  } catch {
    return null
  }
}

function assertAccess(
  ref: FileRef,
  ctx: FileSystemAccessContext,
  intent: "metadata" | "directory" | "content" | "write" | "action" | "watch",
  permission: "fs:read" | "fs:write",
): void {
  if (ctx.actor === "ui") return
  if (ctx.intent === intent && ctx.permissions.includes(permission)) return
  throw new FileSystemError(
    "permission-denied",
    `${ctx.actor} requires ${permission} permission and ${intent} intent`,
    ref,
  )
}

function itemFile(item: TrashItem): IdeallFile {
  return {
    ref: trashItemRef(item.id),
    kind: "file",
    name: item.title,
    mediaType: "application/vnd.ideall.trash-item+json",
    capabilities: ["read", "actions", "watch"],
    source: { kind: "local", id: "trash", label: "回收站" },
    size: item.size,
    updatedAt: item.updatedAt,
    version: String(item.updatedAt),
    properties: { ...item },
  }
}

async function findItem(ref: FileRef, deps: TrashFileSystemDeps): Promise<TrashItem | undefined> {
  const id = itemId(ref)
  return id ? (await deps.list()).find((candidate) => candidate.id === id) : undefined
}

async function requireItem(ref: FileRef, deps: TrashFileSystemDeps): Promise<TrashItem> {
  const item = await findItem(ref, deps)
  if (!item) throw new FileSystemError("not-found", `Trash item not found: ${fileRefKey(ref)}`, ref)
  return item
}

function page(items: TrashItem[], options: ReadDirectoryOptions): DirectoryPage {
  const offset = options.cursor === undefined ? 0 : Number(options.cursor)
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new FileSystemError("invalid-input", "Invalid trash cursor")
  }
  const limit = options.limit ?? items.length
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new FileSystemError("invalid-input", "Invalid trash page limit")
  }
  const values = items.slice(offset, offset + limit)
  return {
    entries: values.map((item, index) => ({
      entryId: trashItemRef(item.id).fileId,
      parent: trashRootRef,
      target: trashItemRef(item.id),
      name: item.title,
      kind: "child",
      sortKey: String(offset + index).padStart(8, "0"),
      properties: { ...item },
    })),
    nextCursor: offset + values.length < items.length ? String(offset + values.length) : undefined,
  }
}

export function createTrashFileSystem(
  overrides: Partial<TrashFileSystemDeps> = {},
): FileSystemProvider {
  const deps: TrashFileSystemDeps = { ...defaultDeps, ...overrides }
  return {
    descriptor: {
      fileSystemId: TRASH_FILE_SYSTEM_ID,
      name: "回收站",
      root: trashRootRef,
      source: { kind: "local", id: "trash", label: "回收站" },
      capabilities: ["read-directory", "read", "delete", "actions", "watch"],
    },
    async stat(ref, ctx) {
      assertAccess(ref, ctx, "metadata", "fs:read")
      if (sameFileRef(ref, trashRootRef)) {
        return {
          ref,
          kind: "directory",
          name: "回收站",
          mediaType: DIRECTORY_MEDIA_TYPE,
          capabilities: ["read-directory", "read", "delete", "actions", "watch"],
          source: this.descriptor.source,
        }
      }
      const item = await findItem(ref, deps)
      return item ? itemFile(item) : null
    },
    async readDirectory(ref, ctx, options = {}) {
      assertAccess(ref, ctx, "directory", "fs:read")
      if (!sameFileRef(ref, trashRootRef)) {
        throw new FileSystemError("unsupported", "Trash item is not a directory", ref)
      }
      return page(await deps.list(), options)
    },
    async read(ref, ctx): Promise<FileReadResult> {
      assertAccess(ref, ctx, "content", "fs:read")
      if (sameFileRef(ref, trashRootRef)) {
        const items = await deps.list()
        return { data: { count: items.length }, mediaType: "application/vnd.ideall.trash+json" }
      }
      const item = await requireItem(ref, deps)
      return {
        data: item,
        mediaType: "application/vnd.ideall.trash-item+json",
        version: String(item.updatedAt),
      }
    },
    async write(ref, _input, ctx) {
      assertAccess(ref, ctx, "write", "fs:write")
      throw new FileSystemError("unsupported", "Trash uses explicit actions", ref)
    },
    async actions(ref, ctx): Promise<FileAction[]> {
      assertAccess(ref, ctx, "action", "fs:read")
      if (sameFileRef(ref, trashRootRef)) {
        return [
          { id: "open", label: "打开" },
          { id: "empty", label: "清空回收站", destructive: true, requires: ["delete"] },
        ]
      }
      const item = await requireItem(ref, deps)
      return [
        ...(item.restorable ? [{ id: "restore", label: "恢复" }] : []),
        { id: "purge", label: "永久删除", destructive: true, requires: ["delete"] },
      ]
    },
    async invoke(ref, action, _input, ctx) {
      const mutation = action === "restore" || action === "purge" || action === "empty"
      assertAccess(ref, ctx, "action", mutation ? "fs:write" : "fs:read")
      if (action === "open") return { ref }
      if (action === "empty" && sameFileRef(ref, trashRootRef)) return { count: await deps.empty() }
      const item = await requireItem(ref, deps)
      if (action === "restore") {
        if (!item.restorable)
          throw new FileSystemError("unsupported", "Trash item cannot be restored", ref)
        await deps.restore(item.kind, item.id)
        return { ref, restored: true }
      }
      if (action === "purge") {
        await deps.purge(item.id)
        return { ref, deleted: true }
      }
      throw new FileSystemError("unsupported", `Unsupported trash action: ${action}`, ref)
    },
    watch(ref, ctx, notify): FileSystemWatchHandle | null {
      assertAccess(ref, ctx, "watch", "fs:read")
      if (!sameFileRef(ref, trashRootRef) && !itemId(ref)) return null
      const watchedId = itemId(ref)
      const dispose = deps.onUpdated((detail) => {
        if (!watchedId || !detail?.id || detail.id === watchedId) notify({ type: "changed", ref })
      })
      return { dispose }
    },
  }
}

export const trashFileSystem = createTrashFileSystem()
