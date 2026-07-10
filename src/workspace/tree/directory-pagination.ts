import type { DirectoryEntry } from "@protocol/file-system"
import type { DirectoryPage, ReadDirectoryOptions } from "@/filesystem/types"

export const DIRECTORY_PAGE_SIZE = 200
export const MAX_DIRECTORY_PAGES = 1_000

export type DirectoryPageReader = (options: ReadDirectoryOptions) => Promise<DirectoryPage>

export type ReadAllDirectoryEntriesOptions = {
  pageSize?: number
  maxPages?: number
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer`)
  }
  return value
}

/**
 * 完整读取一个目录，同时约束错误 provider：entryId 跨页去重，重复 cursor 会失败，
 * 页数上限避免永不终止的 cursor 流耗尽客户端资源。
 */
export async function readAllDirectoryEntries(
  readPage: DirectoryPageReader,
  options: ReadAllDirectoryEntriesOptions = {},
): Promise<DirectoryEntry[]> {
  const pageSize = positiveInteger(options.pageSize ?? DIRECTORY_PAGE_SIZE, "pageSize")
  const maxPages = positiveInteger(options.maxPages ?? MAX_DIRECTORY_PAGES, "maxPages")
  const entries: DirectoryEntry[] = []
  const seenEntryIds = new Set<string>()
  const seenCursors = new Set<string>()
  let cursor: string | undefined

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    if (cursor !== undefined) {
      if (seenCursors.has(cursor)) {
        throw new Error(`Directory pagination cursor loop detected at ${JSON.stringify(cursor)}`)
      }
      seenCursors.add(cursor)
    }

    const page = await readPage({
      limit: pageSize,
      ...(cursor === undefined ? {} : { cursor }),
    })

    for (const entry of page.entries) {
      if (seenEntryIds.has(entry.entryId)) continue
      seenEntryIds.add(entry.entryId)
      entries.push(entry)
    }

    if (page.nextCursor === undefined) return entries
    if (seenCursors.has(page.nextCursor)) {
      throw new Error(
        `Directory pagination cursor loop detected at ${JSON.stringify(page.nextCursor)}`,
      )
    }
    cursor = page.nextCursor
  }

  throw new Error(`Directory pagination exceeded ${maxPages} pages`)
}
