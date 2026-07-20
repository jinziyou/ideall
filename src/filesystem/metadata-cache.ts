import { fileRefKey, type FileRef, type IdeallFile } from "@protocol/file-system"
import { getFileSystem, statFile } from "./registry"
import type { FileSystemAccessContext, FileSystemProvider } from "./types"

type MetadataCacheEntry = Readonly<{
  provider: FileSystemProvider
  file: IdeallFile
}>

type PendingMetadataRead = Readonly<{
  provider: FileSystemProvider
  promise: Promise<IdeallFile | null>
}>

const metadata = new Map<string, MetadataCacheEntry>()
const pending = new Map<string, PendingMetadataRead>()

/**
 * File metadata is frequently read once while resolving navigation and immediately again when the
 * selected Display mounts. Keep that already-authorized metadata in memory for the hand-off. A
 * provider replacement invalidates entries by identity, so a remounted source cannot inherit an
 * older generation's result.
 */
export function rememberFileMetadata(file: IdeallFile): void {
  const provider = getFileSystem(file.ref.fileSystemId)
  if (!provider) return
  metadata.set(fileRefKey(file.ref), { provider, file })
}

export function cachedFileMetadata(ref: FileRef): IdeallFile | null {
  const key = fileRefKey(ref)
  const entry = metadata.get(key)
  if (!entry) return null
  if (getFileSystem(ref.fileSystemId) === entry.provider) return entry.file
  metadata.delete(key)
  return null
}

/**
 * Read-through stat with per-provider in-flight deduplication. `refresh` bypasses a settled cache
 * entry but still joins an identical refresh already in progress.
 */
export function statFileCached(
  ref: FileRef,
  ctx: FileSystemAccessContext,
  options: Readonly<{ refresh?: boolean }> = {},
): Promise<IdeallFile | null> {
  const provider = getFileSystem(ref.fileSystemId)
  if (!provider) return statFile(ref, ctx)
  if (!options.refresh) {
    const cached = cachedFileMetadata(ref)
    if (cached) return Promise.resolve(cached)
  }

  const key = fileRefKey(ref)
  const existing = pending.get(key)
  if (existing?.provider === provider) return existing.promise

  const promise = statFile(ref, ctx)
    .then((file) => {
      if (getFileSystem(ref.fileSystemId) !== provider) return null
      if (file) rememberFileMetadata(file)
      else metadata.delete(key)
      return file
    })
    .finally(() => {
      if (pending.get(key)?.promise === promise) pending.delete(key)
    })
  pending.set(key, { provider, promise })
  return promise
}

export function clearFileMetadataCacheForTest(): void {
  metadata.clear()
  pending.clear()
}
