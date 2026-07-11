import type { FileRef } from "@protocol/file-system"
import type { ReadDirectoryOptions } from "./types"
import { FileSystemError } from "./types"

export type DirectoryItemsPage<T> = {
  items: T[]
  offset: number
  nextCursor?: string
}

function directoryOffset(ref: FileRef, cursor: string | undefined): number {
  if (cursor === undefined) return 0
  if (!/^(0|[1-9]\d*)$/.test(cursor)) {
    throw new FileSystemError("invalid-input", `Invalid directory cursor: ${cursor}`, ref)
  }
  const offset = Number(cursor)
  if (!Number.isSafeInteger(offset)) {
    throw new FileSystemError("invalid-input", `Invalid directory cursor: ${cursor}`, ref)
  }
  return offset
}

function directoryLimit(ref: FileRef, limit: number | undefined, total: number): number {
  if (limit === undefined) return total
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new FileSystemError(
      "invalid-input",
      "Directory limit must be a positive safe integer",
      ref,
    )
  }
  return limit
}

/**
 * 内存型 FileSystem provider 共用的 offset cursor 契约。
 * 显式 cursor 必须是规范的非负十进制安全整数，显式 limit 必须是正安全整数；
 * 省略 limit 时保持 provider 原有的整页返回行为。
 */
export function paginateDirectoryItems<T>(
  ref: FileRef,
  items: readonly T[],
  options: ReadDirectoryOptions,
): DirectoryItemsPage<T> {
  const offset = directoryOffset(ref, options.cursor)
  const limit = directoryLimit(ref, options.limit, items.length)
  const pageItems = items.slice(offset, offset + limit)
  const nextOffset = offset + pageItems.length
  return {
    items: pageItems,
    offset,
    ...(nextOffset < items.length ? { nextCursor: String(nextOffset) } : {}),
  }
}
