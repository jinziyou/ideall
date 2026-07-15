import { sameFileRef, type FileRef, type IdeallFile } from "@protocol/file-system"
import type { FileMeta } from "@protocol/files"
import { readAllDirectoryEntries } from "@/filesystem/directory-pagination"
import { fileSystemRegistry, type FileSystemRegistry } from "@/filesystem/registry"
import { corePlaceRef, resourceRefForFile } from "@/filesystem/resource-file-system"
import { FileSystemError } from "@/filesystem/types"
import { mapConcurrentOrdered } from "@/lib/map-concurrent-ordered"

export type ManagedFile = FileMeta & { ref: FileRef; version: string | null }

export type ManagedFilesGateway = Pick<FileSystemRegistry, "readDirectory" | "stat">

export type ManagedFilesLoadOptions = {
  statConcurrency?: number
}

const FILES_ROOT_REF = corePlaceRef("files")
const UI_DIRECTORY_CONTEXT = { actor: "ui", permissions: [], intent: "directory" } as const
const UI_METADATA_CONTEXT = { actor: "ui", permissions: [], intent: "metadata" } as const
const DEFAULT_STAT_CONCURRENCY = 4
const MAX_STAT_CONCURRENCY = 32

function statConcurrency(value: number | undefined): number {
  const concurrency = value ?? DEFAULT_STAT_CONCURRENCY
  if (
    !Number.isSafeInteger(concurrency) ||
    concurrency <= 0 ||
    concurrency > MAX_STAT_CONCURRENCY
  ) {
    throw new FileSystemError(
      "invalid-input",
      `statConcurrency must be an integer between 1 and ${MAX_STAT_CONCURRENCY}`,
      FILES_ROOT_REF,
    )
  }
  return concurrency
}

function managedFile(ref: FileRef, file: IdeallFile): ManagedFile | null {
  const resource = resourceRefForFile(ref)
  if (resource?.scheme !== "node" || resource.kind !== "file") return null
  const tags = file.properties?.tags
  return {
    ref,
    id: resource.id,
    name: file.name,
    type: file.mediaType,
    size: file.size ?? 0,
    createdAt: file.createdAt ?? 0,
    tags: Array.isArray(tags) && tags.every((tag) => typeof tag === "string") ? [...tags] : [],
    version: file.version ?? null,
  }
}

/** 多页读取文件目录；合法 metadata snapshot 直接复用，缺失项才有限并发 stat。 */
export async function loadManagedFiles(
  gateway: ManagedFilesGateway = fileSystemRegistry,
  options: ManagedFilesLoadOptions = {},
): Promise<ManagedFile[]> {
  const entries = await readAllDirectoryEntries(
    (pageOptions) => gateway.readDirectory(FILES_ROOT_REF, UI_DIRECTORY_CONTEXT, pageOptions),
    { ref: FILES_ROOT_REF, dedupeEntryIds: true },
  )
  const candidates = entries.filter((entry) => {
    const resource = resourceRefForFile(entry.target)
    return resource?.scheme === "node" && resource.kind === "file"
  })
  const files = await mapConcurrentOrdered(
    candidates,
    statConcurrency(options.statConcurrency),
    async (entry): Promise<ManagedFile | null> => {
      const snapshot =
        entry.file && sameFileRef(entry.file.ref, entry.target)
          ? entry.file
          : await gateway.stat(entry.target, UI_METADATA_CONTEXT)
      return snapshot ? managedFile(entry.target, snapshot) : null
    },
  )
  return files
    .filter((file): file is ManagedFile => file !== null)
    .sort((left, right) => right.createdAt - left.createdAt)
}
