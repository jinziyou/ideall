import { fileRefKey, type DirectoryEntry, type FileRef } from "@protocol/file-system"
import { readFileDirectory } from "./registry"
import type { FileSystemAccessContext } from "./types"
import { readAllDirectoryEntries } from "./directory-pagination"

export async function readCompleteDirectory(
  ref: FileRef,
  ctx: FileSystemAccessContext,
): Promise<DirectoryEntry[]> {
  return readAllDirectoryEntries((options) => readFileDirectory(ref, ctx, options), { ref })
}

/** 按目录项投影广度优先遍历；是否下降由调用者依据 kind/capability 决定。 */
export async function walkFileDirectory(
  root: FileRef,
  ctx: FileSystemAccessContext,
  descend: (entry: DirectoryEntry) => boolean,
): Promise<DirectoryEntry[]> {
  const result: DirectoryEntry[] = []
  const queue = [root]
  const visited = new Set<string>()
  while (queue.length > 0) {
    const directory = queue.shift() as FileRef
    const key = fileRefKey(directory)
    if (visited.has(key)) continue
    visited.add(key)
    const entries = await readCompleteDirectory(directory, ctx)
    result.push(...entries)
    for (const entry of entries) {
      if (descend(entry)) queue.push(entry.target)
    }
  }
  return result
}
