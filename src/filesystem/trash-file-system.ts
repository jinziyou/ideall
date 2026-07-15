import { fileRefKey, sameFileRef, type FileRef, type IdeallFile } from "@protocol/file-system"
import { onFilesUpdated } from "@protocol/flowback"
import {
  emptyTrash,
  listTrashItems,
  purgeTrashItem,
  type TrashCollectionExpectation,
  type TrashMutationExpectation,
  type TrashItem,
} from "@/files/stores/trash-store"
import { restoreNode } from "@/files/stores/nodes-store"
import { sha256SemanticVersion } from "@/lib/semantic-version"
import type {
  DirectoryPage,
  FileAction,
  FileActionInvokeOptions,
  FileReadResult,
  FileSystemAccessContext,
  FileSystemProvider,
  FileSystemWatchHandle,
  ReadDirectoryOptions,
} from "./types"
import { FileSystemError } from "./types"

export type TrashFileItem = TrashItem

export type TrashFileSystemDeps = {
  collectionVersion: typeof trashCollectionVersion
  empty: (expected: readonly TrashCollectionExpectation[]) => Promise<number | null>
  list: typeof listTrashItems
  purge: (id: string, expected: TrashMutationExpectation) => Promise<boolean>
  restore: (
    kind: TrashItem["kind"],
    id: string,
    expected: TrashMutationExpectation,
  ) => Promise<boolean>
  onUpdated: typeof onFilesUpdated
}

const defaultDeps: TrashFileSystemDeps = {
  collectionVersion: trashCollectionVersion,
  empty: emptyTrash,
  list: listTrashItems,
  purge: purgeTrashItem,
  restore: restoreNode,
  onUpdated: onFilesUpdated,
}

export const TRASH_FILE_SYSTEM_ID = "ideall.trash"
export const TRASH_ROOT_MEDIA_TYPE = "application/vnd.ideall.trash+json"
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

function mutationExpectation(item: TrashItem): TrashMutationExpectation {
  return { kind: item.kind, updatedAt: item.updatedAt, deletedAt: item.deletedAt }
}

function collectionExpectation(items: readonly TrashItem[]): readonly TrashCollectionExpectation[] {
  return Object.freeze(
    items.map(({ id, kind, updatedAt, deletedAt }) =>
      Object.freeze({ id, kind, updatedAt, deletedAt }),
    ),
  )
}

export function trashCollectionVersion(
  items: readonly Pick<TrashItem, "id" | "kind" | "updatedAt" | "deletedAt">[],
): Promise<string> {
  const snapshot = items
    .map(({ id, kind, updatedAt, deletedAt }) => JSON.stringify([id, kind, updatedAt, deletedAt]))
    .sort()
  return sha256SemanticVersion("trash-v2", JSON.stringify(snapshot))
}

async function assertExpectedCollectionVersion(
  ref: FileRef,
  items: readonly Pick<TrashItem, "id" | "kind" | "updatedAt" | "deletedAt">[],
  expectedVersion: FileActionInvokeOptions["expectedVersion"],
  version: TrashFileSystemDeps["collectionVersion"],
): Promise<void> {
  if (expectedVersion === undefined) return
  const currentVersion = await version(items)
  if (expectedVersion === currentVersion) return
  throw new FileSystemError(
    "conflict",
    `Trash collection changed (expected ${expectedVersion ?? "no version"}, current ${currentVersion})`,
    ref,
  )
}

function assertExpectedVersion(
  ref: FileRef,
  item: TrashItem,
  expectedVersion: FileActionInvokeOptions["expectedVersion"],
): void {
  if (expectedVersion === undefined) return
  const currentVersion = String(item.updatedAt)
  if (expectedVersion === currentVersion) return
  throw new FileSystemError(
    "conflict",
    `Trash item version changed (expected ${expectedVersion ?? "no version"}, current ${currentVersion})`,
    ref,
  )
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
          mediaType: TRASH_ROOT_MEDIA_TYPE,
          capabilities: ["read-directory", "read", "delete", "actions", "watch"],
          source: this.descriptor.source,
          properties: { trashRoot: true },
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
        const items = collectionExpectation(await deps.list())
        return {
          data: { count: items.length },
          mediaType: TRASH_ROOT_MEDIA_TYPE,
          version: await deps.collectionVersion(items),
        }
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
          { id: "open", label: "打开", kind: "display" },
          {
            id: "empty",
            label: "清空回收站",
            kind: "specialized",
            reason: "需要在回收站界面冻结当前集合版本并确认后执行。",
            risk: "destructive",
            idempotent: true,
            requires: ["delete"],
          },
        ]
      }
      const item = await requireItem(ref, deps)
      return [
        ...(item.restorable
          ? ([
              { id: "restore", label: "恢复", kind: "invoke", idempotent: false },
            ] satisfies FileAction[])
          : []),
        {
          id: "purge",
          label: "永久删除",
          kind: "invoke",
          risk: "destructive",
          idempotent: true,
          requires: ["delete"],
        },
      ]
    },
    async invoke(ref, action, _input, ctx, options) {
      const mutation = action === "restore" || action === "purge" || action === "empty"
      assertAccess(ref, ctx, "action", mutation ? "fs:write" : "fs:read")
      if (action === "open") return { ref }
      if (action === "empty" && sameFileRef(ref, trashRootRef)) {
        const items = collectionExpectation(await deps.list())
        await assertExpectedCollectionVersion(
          ref,
          items,
          options?.expectedVersion,
          deps.collectionVersion,
        )
        const count = await deps.empty(items)
        if (count === null) {
          throw new FileSystemError("conflict", "Trash collection changed before empty", ref)
        }
        return { count }
      }
      const item = await requireItem(ref, deps)
      if (action === "restore") {
        assertExpectedVersion(ref, item, options?.expectedVersion)
        if (!item.restorable)
          throw new FileSystemError("unsupported", "Trash item cannot be restored", ref)
        const restored = await deps.restore(item.kind, item.id, mutationExpectation(item))
        if (!restored) {
          throw new FileSystemError("conflict", "Trash item changed before restore", ref)
        }
        return { ref, restored: true }
      }
      if (action === "purge") {
        assertExpectedVersion(ref, item, options?.expectedVersion)
        const deleted = await deps.purge(item.id, mutationExpectation(item))
        if (!deleted) {
          throw new FileSystemError("conflict", "Trash item changed before purge", ref)
        }
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
