import { sameFileRef, type DirectoryEntry, type IdeallFile } from "@protocol/file-system"
import { cachedFileMetadata, rememberFileMetadata } from "./metadata-cache"
import { statFiles } from "./registry"
import type { FileSystemAccessContext } from "./types"

export type DirectoryEntryMetadata = Readonly<{
  entry: DirectoryEntry
  file: IdeallFile | null
}>

/** Project directory structure immediately from embedded or cached metadata without I/O. */
export function projectDirectoryEntryMetadata(
  entries: readonly DirectoryEntry[],
): DirectoryEntryMetadata[] {
  return entries.map((entry) => {
    const embedded = entry.file && sameFileRef(entry.file.ref, entry.target) ? entry.file : null
    const file = embedded ?? cachedFileMetadata(entry.target)
    if (file) rememberFileMetadata(file)
    return { entry, file }
  })
}

/**
 * Resolve missing metadata in one native batch per provider. Provider failures stay isolated and
 * successful groups are published progressively instead of blocking the entire directory.
 */
export async function resolveDirectoryEntryMetadata(
  projected: readonly DirectoryEntryMetadata[],
  ctx: FileSystemAccessContext,
  onProgress?: (items: readonly DirectoryEntryMetadata[]) => void,
): Promise<DirectoryEntryMetadata[]> {
  const result = [...projected]
  const groups = new Map<string, Array<{ index: number; entry: DirectoryEntry }>>()
  projected.forEach((item, index) => {
    if (item.file) return
    const group = groups.get(item.entry.target.fileSystemId) ?? []
    group.push({ index, entry: item.entry })
    groups.set(item.entry.target.fileSystemId, group)
  })

  await Promise.all(
    [...groups.values()].map(async (group) => {
      try {
        const files = await statFiles(
          group.map(({ entry }) => entry.target),
          ctx,
        )
        group.forEach(({ index, entry }, resultIndex) => {
          const file = files[resultIndex]
          if (!file || !sameFileRef(file.ref, entry.target)) return
          rememberFileMetadata(file)
          result[index] = { entry, file }
        })
        onProgress?.([...result])
      } catch {
        // A missing runtime extension must not hide entries owned by other providers.
      }
    }),
  )
  return result
}
