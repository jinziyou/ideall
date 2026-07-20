import type { DirectoryEntry, FileRef } from "@protocol/file-system"
import type { DirectoryPage, ReadDirectoryOptions } from "./types"
import { FileSystemError } from "./types"

export const DIRECTORY_PAGE_SIZE = 200
export const MAX_DIRECTORY_PAGES = 1_000
export const MAX_DIRECTORY_ENTRIES = DIRECTORY_PAGE_SIZE * MAX_DIRECTORY_PAGES

export type DirectoryPageReader = (options: ReadDirectoryOptions) => Promise<DirectoryPage>

export type DirectoryPaginationOptions = {
  pageSize?: number
  maxPages?: number
  maxEntries?: number
  ref?: FileRef
}

export type ReadAllDirectoryEntriesOptions = DirectoryPaginationOptions & {
  /** 目录树兼容入口可按 provider 的 parent-scoped entryId 跨页去重。 */
  dedupeEntryIds?: boolean
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new FileSystemError("invalid-input", `${label} must be a positive safe integer`)
  }
  return value
}

function paginationFailure(message: string, ref?: FileRef): FileSystemError {
  return new FileSystemError("unavailable", message, ref)
}

/**
 * 有界消费 provider 的 cursor 分页。重复 cursor、无限唯一 cursor 和超量条目都会失败关闭，
 * 防止错误或扩展 provider 让调用方永久循环或无限占用内存。
 */
export async function* iterateDirectoryPages(
  readPage: DirectoryPageReader,
  options: DirectoryPaginationOptions = {},
): AsyncGenerator<readonly DirectoryEntry[]> {
  const pageSize = positiveInteger(options.pageSize ?? DIRECTORY_PAGE_SIZE, "pageSize")
  const maxPages = positiveInteger(options.maxPages ?? MAX_DIRECTORY_PAGES, "maxPages")
  const maxEntries = positiveInteger(options.maxEntries ?? MAX_DIRECTORY_ENTRIES, "maxEntries")
  const seenCursors = new Set<string>()
  let cursor: string | undefined
  let entryCount = 0

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const page = await readPage({
      limit: pageSize,
      ...(cursor === undefined ? {} : { cursor }),
    })
    entryCount += page.entries.length
    if (entryCount > maxEntries) {
      throw paginationFailure(`Directory pagination exceeded ${maxEntries} entries`, options.ref)
    }
    yield page.entries

    const nextCursor = page.nextCursor
    if (!nextCursor) return
    if (seenCursors.has(nextCursor)) {
      throw paginationFailure(
        `Directory pagination cursor loop detected at ${JSON.stringify(nextCursor)}`,
        options.ref,
      )
    }
    seenCursors.add(nextCursor)
    cursor = nextCursor
  }

  throw paginationFailure(`Directory pagination exceeded ${maxPages} pages`, options.ref)
}

/** 完整读取目录；终止与资源上限由 iterateDirectoryPages 统一保证。 */
export async function readAllDirectoryEntries(
  readPage: DirectoryPageReader,
  options: ReadAllDirectoryEntriesOptions = {},
): Promise<DirectoryEntry[]> {
  const entries: DirectoryEntry[] = []
  const seenEntryIds = options.dedupeEntryIds ? new Set<string>() : null
  for await (const pageEntries of iterateDirectoryPages(readPage, options)) {
    for (const entry of pageEntries) {
      if (seenEntryIds?.has(entry.entryId)) continue
      seenEntryIds?.add(entry.entryId)
      entries.push(entry)
    }
  }
  return entries
}
