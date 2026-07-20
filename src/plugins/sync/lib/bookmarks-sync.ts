// 书签跨端同步：收藏夹与书签共用一个加密块，保证父子关系按同一快照合并和落地。
import type { BookmarkSyncNode } from "@protocol/storage-sync"
import { getStorageSyncPort } from "@protocol/storage-sync"
import {
  isSaneSyncTimestamp,
  pruneExpiredTombstones,
  SYNC_BLOCK_BUDGETS,
  unionMerge,
  type SyncResult,
} from "@protocol/sync"
import { safeHref } from "@/lib/safe-url"
import type { DomainSyncConfig } from "./sync-domain-runner"
import { runDomainSync } from "./sync-domain-machine"

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function hasCommonNodeFields(value: Record<string, unknown>, now: number): boolean {
  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.title === "string" &&
    typeof value.sortKey === "string" &&
    isStringArray(value.tags) &&
    isSaneSyncTimestamp(value.createdAt, now) &&
    isSaneSyncTimestamp(value.updatedAt, now) &&
    (value.deletedAt === undefined || isSaneSyncTimestamp(value.deletedAt, now)) &&
    (value.meta === undefined ||
      (value.meta !== null && typeof value.meta === "object" && !Array.isArray(value.meta)))
  )
}

/** 持同步码的失陷或旧端仍是不可信输入；合并前拒绝坏结构和可执行伪协议。 */
export function isValidRemoteBookmarkNode(
  value: unknown,
  now: number = Date.now(),
): value is BookmarkSyncNode {
  if (!value || typeof value !== "object") return false
  const node = value as Record<string, unknown>
  if (!hasCommonNodeFields(node, now)) return false
  if (node.kind === "folder") {
    return node.parentId === null && (node.content === undefined || node.content === null)
  }
  if (node.kind !== "bookmark") return false
  if (node.parentId !== null && (typeof node.parentId !== "string" || node.parentId.length === 0)) {
    return false
  }
  if (!node.content || typeof node.content !== "object" || Array.isArray(node.content)) return false
  const content = node.content as Record<string, unknown>
  return (
    typeof content.url === "string" &&
    Boolean(safeHref(content.url)) &&
    typeof content.description === "string" &&
    typeof content.favicon === "string"
  )
}

/**
 * 保持书签集合引用完整：活跃书签只能指向同一快照中的活跃收藏夹。
 * 孤儿确定性移到根级，并把版本推进到自身/父夹墓碑之后，避免旧离线快照反复挂回失效父夹。
 */
export function gcBookmarks(nodes: BookmarkSyncNode[], now: number): BookmarkSyncNode[] {
  const kept = pruneExpiredTombstones(nodes, now)
  const activeFolderIds = new Set(
    kept
      .filter((node) => node.kind === "folder" && node.deletedAt === undefined)
      .map((node) => node.id),
  )
  const folderVersions = new Map(
    kept.filter((node) => node.kind === "folder").map((node) => [node.id, node.updatedAt]),
  )
  return kept.map((node) => {
    if (
      node.kind !== "bookmark" ||
      node.deletedAt !== undefined ||
      node.parentId === null ||
      activeFolderIds.has(node.parentId)
    ) {
      return node
    }
    return {
      ...node,
      parentId: null,
      updatedAt: Math.max(node.updatedAt, folderVersions.get(node.parentId) ?? node.updatedAt) + 1,
    }
  })
}

export const bookmarksSyncConfig: DomainSyncConfig<BookmarkSyncNode> = {
  keyScope: "bookmarks",
  budget: SYNC_BLOCK_BUDGETS.bookmarks,
  listLocal: () => getStorageSyncPort().listAllBookmarkNodes(),
  merge: unionMerge,
  gc: gcBookmarks,
  bulkPut: (items, expectedLocal) =>
    getStorageSyncPort().bulkPutBookmarkNodes(items, expectedLocal),
  isValidRemote: isValidRemoteBookmarkNode,
}

export async function syncBookmarks(code: string): Promise<SyncResult> {
  return runDomainSync(code, bookmarksSyncConfig)
}
