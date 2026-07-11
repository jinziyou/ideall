import {
  readAllDirectoryEntries as readAllFileSystemDirectoryEntries,
  type DirectoryPageReader as FileSystemDirectoryPageReader,
  type ReadAllDirectoryEntriesOptions as FileSystemReadAllDirectoryEntriesOptions,
} from "@/filesystem/directory-pagination"

export {
  DIRECTORY_PAGE_SIZE,
  MAX_DIRECTORY_ENTRIES,
  MAX_DIRECTORY_PAGES,
} from "@/filesystem/directory-pagination"
export type { DirectoryPageReader } from "@/filesystem/directory-pagination"

export type ReadAllDirectoryEntriesOptions = Omit<
  FileSystemReadAllDirectoryEntriesOptions,
  "dedupeEntryIds" | "ref"
>

/**
 * 完整读取一个目录，同时约束错误 provider：entryId 跨页去重，重复 cursor 会失败，
 * 页数上限避免永不终止的 cursor 流耗尽客户端资源。
 */
export async function readAllDirectoryEntries(
  readPage: FileSystemDirectoryPageReader,
  options: ReadAllDirectoryEntriesOptions = {},
): ReturnType<typeof readAllFileSystemDirectoryEntries> {
  return readAllFileSystemDirectoryEntries(readPage, { ...options, dedupeEntryIds: true })
}
