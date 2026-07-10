import {
  DIRECTORY_MEDIA_TYPE,
  fileRefKey,
  sameFileRef,
  type DirectoryEntry,
  type FileRef,
  type FileSource,
  type IdeallFile,
} from "@protocol/file-system"
import { FileSystemRegistry } from "./registry"
import type {
  DirectoryPage,
  FileAction,
  FileReadOptions,
  FileReadResult,
  FileSystemAccessContext,
  FileSystemDescriptor,
  FileSystemProvider,
  FileSystemWatchEvent,
  FileSystemWatchHandle,
  FileWriteInput,
  ReadDirectoryOptions,
} from "./types"
import { FileSystemError } from "./types"

export type CompositeRootEntry = {
  entryId: string
  name: string
  target: FileRef
  sortKey?: string
  properties?: Readonly<Record<string, unknown>>
}

export type CompositeRootOptions = {
  fileSystemId?: string
  rootFileId?: string
  name?: string
  source?: FileSource
  coreEntries?: readonly CompositeRootEntry[]
}

type StoredEntry = CompositeRootEntry & { origin: "core" | "mount" }

function compareText(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function compareEntries(left: StoredEntry, right: StoredEntry): number {
  const leftKey = left.sortKey ?? `\uffff${left.name}`
  const rightKey = right.sortKey ?? `\uffff${right.name}`
  return compareText(leftKey, rightKey) || compareText(left.entryId, right.entryId)
}

function parsePageOffset(cursor: string | undefined): number {
  if (cursor === undefined) return 0
  if (!/^(0|[1-9]\d*)$/.test(cursor)) {
    throw new FileSystemError("invalid-input", `Invalid directory cursor: ${cursor}`)
  }
  return Number(cursor)
}

function pageLimit(limit: number | undefined, total: number): number {
  if (limit === undefined) return total
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new FileSystemError("invalid-input", "Directory page limit must be a positive integer")
  }
  return limit
}

/**
 * 隐藏根的合成文件系统。根的直接目录项由核心入口与运行期挂载共同组成；目标文件仍由
 * 各自 provider 持有，合成根不会复制内容或重写目标身份。
 */
export class CompositeRootFileSystem implements FileSystemProvider {
  readonly descriptor: FileSystemDescriptor
  private readonly entries = new Map<string, StoredEntry>()
  private readonly entryNames = new Map<string, string>()
  private readonly watchers = new Set<(event: FileSystemWatchEvent) => void>()

  constructor(options: CompositeRootOptions = {}) {
    const fileSystemId = options.fileSystemId ?? "ideall.root"
    const root: FileRef = { fileSystemId, fileId: options.rootFileId ?? "root" }
    this.descriptor = {
      fileSystemId,
      root,
      name: options.name ?? "ideall",
      source: options.source ?? { kind: "system", id: "ideall" },
      capabilities: ["read-directory", "watch"],
    }

    for (const entry of options.coreEntries ?? []) {
      this.addEntry(entry, "core")
    }
  }

  private addEntry(entry: CompositeRootEntry, origin: StoredEntry["origin"]): void {
    if (!entry.entryId || !entry.name || !entry.target.fileSystemId || !entry.target.fileId) {
      throw new FileSystemError("invalid-input", "Composite root entry fields cannot be empty")
    }
    if (this.entries.has(entry.entryId)) {
      throw new FileSystemError(
        "already-exists",
        `Composite root entry already exists: ${entry.entryId}`,
      )
    }
    if (this.entryNames.has(entry.name)) {
      throw new FileSystemError(
        "conflict",
        `Composite root entry name already exists: ${entry.name}`,
      )
    }
    this.entries.set(entry.entryId, { ...entry, origin })
    this.entryNames.set(entry.name, entry.entryId)
  }

  private removeEntry(entryId: string, origin: StoredEntry["origin"]): boolean {
    const entry = this.entries.get(entryId)
    if (!entry || entry.origin !== origin) return false
    this.entries.delete(entryId)
    this.entryNames.delete(entry.name)
    return true
  }

  private emit(entryId: string): void {
    const event: FileSystemWatchEvent = {
      type: "mount-changed",
      ref: this.descriptor.root,
      entryId,
    }
    for (const notify of this.watchers) {
      try {
        notify(event)
      } catch {
        // 观察者故障不能回滚一个已经完成的挂载，也不能阻断其它观察者。
      }
    }
  }

  /** 注册动态挂载；释放句柄仅删除目录项，不删除目标文件。 */
  mount(entry: CompositeRootEntry): () => void {
    this.addEntry(entry, "mount")
    this.emit(entry.entryId)

    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      if (this.removeEntry(entry.entryId, "mount")) this.emit(entry.entryId)
    }
  }

  listEntries(): DirectoryEntry[] {
    return [...this.entries.values()].sort(compareEntries).map((entry) => ({
      entryId: entry.entryId,
      parent: this.descriptor.root,
      target: entry.target,
      name: entry.name,
      kind: entry.origin === "mount" ? "mount" : "link",
      sortKey: entry.sortKey,
      properties: entry.properties,
    }))
  }

  async stat(ref: FileRef, _ctx: FileSystemAccessContext): Promise<IdeallFile | null> {
    if (!sameFileRef(ref, this.descriptor.root)) return null
    return {
      ref: this.descriptor.root,
      kind: "directory",
      name: this.descriptor.name,
      mediaType: DIRECTORY_MEDIA_TYPE,
      capabilities: this.descriptor.capabilities ?? [],
      source: this.descriptor.source,
      properties: { hidden: true, composite: true },
    }
  }

  async readDirectory(
    ref: FileRef,
    _ctx: FileSystemAccessContext,
    options: ReadDirectoryOptions = {},
  ): Promise<DirectoryPage> {
    if (!sameFileRef(ref, this.descriptor.root)) {
      throw new FileSystemError(
        "not-found",
        `Composite directory not found: ${fileRefKey(ref)}`,
        ref,
      )
    }
    const entries = this.listEntries()
    const offset = parsePageOffset(options.cursor)
    const limit = pageLimit(options.limit, entries.length)
    const page = entries.slice(offset, offset + limit)
    const nextOffset = offset + page.length
    return {
      entries: page,
      nextCursor: nextOffset < entries.length ? String(nextOffset) : undefined,
    }
  }

  async read(
    ref: FileRef,
    _ctx: FileSystemAccessContext,
    _options?: FileReadOptions,
  ): Promise<FileReadResult> {
    throw new FileSystemError("unsupported", "Composite root has no readable content", ref)
  }

  async write(
    ref: FileRef,
    _input: FileWriteInput,
    _ctx: FileSystemAccessContext,
  ): Promise<IdeallFile> {
    throw new FileSystemError("unsupported", "Composite root is read-only", ref)
  }

  async actions(_ref: FileRef, _ctx: FileSystemAccessContext): Promise<FileAction[]> {
    return []
  }

  async invoke(
    ref: FileRef,
    action: string,
    _input: unknown,
    _ctx: FileSystemAccessContext,
  ): Promise<unknown> {
    throw new FileSystemError("unsupported", `Unsupported composite root action: ${action}`, ref)
  }

  watch(
    ref: FileRef,
    _ctx: FileSystemAccessContext,
    notify: (event: FileSystemWatchEvent) => void,
  ): FileSystemWatchHandle | null {
    if (!sameFileRef(ref, this.descriptor.root)) return null
    this.watchers.add(notify)
    return { dispose: () => this.watchers.delete(notify) }
  }
}

export type FileSystemMountOptions = Omit<CompositeRootEntry, "target"> & {
  /** 缺省挂载 provider 根；也可显式挂载该 provider 内的子树。 */
  target?: FileRef
}

/** 原子注册 provider 并将其暴露到合成根；挂载冲突时会回滚 provider 注册。 */
export function mountFileSystem(
  registry: FileSystemRegistry,
  compositeRoot: CompositeRootFileSystem,
  provider: FileSystemProvider,
  options: FileSystemMountOptions,
): () => void {
  const target = options.target ?? provider.descriptor.root
  if (target.fileSystemId !== provider.descriptor.fileSystemId) {
    throw new FileSystemError(
      "invalid-input",
      "Mounted target must belong to the registered file system",
      target,
    )
  }

  const unregister = registry.register(provider)
  let unmount: (() => void) | undefined
  try {
    unmount = compositeRoot.mount({ ...options, target })
  } catch (error) {
    unregister()
    throw error
  }

  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    unmount?.()
    unregister()
  }
}
