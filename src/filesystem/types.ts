import type {
  DirectoryEntry,
  FileCapability,
  FileRef,
  FileSource,
  IdeallFile,
} from "@protocol/file-system"

export type {
  DirectoryEntry,
  DirectoryEntryKind,
  FileCapability,
  FileKind,
  FileRef,
  FileSource,
  FileSourceKind,
  IdeallFile,
  StandardFileCapability,
} from "@protocol/file-system"

export type FileSystemActor = "ui" | "agent" | "embed" | "engine" | "system"

export type FileAccessIntent = "metadata" | "directory" | "content" | "write" | "action" | "watch"

export type FileSystemAccessContext = {
  actor: FileSystemActor
  permissions: readonly string[]
  activeFile?: FileRef
  intent?: FileAccessIntent
}

export type ReadDirectoryOptions = {
  cursor?: string
  limit?: number
}

export type DirectoryPage = {
  entries: DirectoryEntry[]
  nextCursor?: string
}

export type FileReadEncoding = "binary" | "text" | "json"

export type FileReadOptions = {
  encoding?: FileReadEncoding
  /** 以字节为单位的 end-exclusive 区间；不支持字节寻址的 provider 必须明确拒绝。 */
  range?: { start: number; end?: number }
}

export type FileReadResult<T = unknown> = {
  data: T
  mediaType: string
  size?: number
  version?: string
}

export type FileWriteInput<T = unknown> = {
  data: T
  mediaType?: string
  /** 缺省表示不做并发前置条件；null 表示仅当目标尚无版本时写入。 */
  expectedVersion?: string | null
}

export type FileAction = {
  id: string
  label: string
  destructive?: boolean
  requires?: readonly FileCapability[]
}

export type FileSystemWatchEvent = {
  type: "changed" | "created" | "deleted" | "mount-changed"
  ref: FileRef
  entryId?: string
}

export type FileSystemWatchHandle = {
  dispose(): void
}

export type FileSystemDescriptor = {
  fileSystemId: string
  name: string
  root: FileRef
  source: FileSource
  capabilities?: readonly FileCapability[]
}

/** 一个 provider 实例对应一个可独立挂载的文件系统实例。 */
export type FileSystemProvider = {
  descriptor: FileSystemDescriptor
  stat(ref: FileRef, ctx: FileSystemAccessContext): Promise<IdeallFile | null>
  readDirectory(
    ref: FileRef,
    ctx: FileSystemAccessContext,
    options?: ReadDirectoryOptions,
  ): Promise<DirectoryPage>
  read(
    ref: FileRef,
    ctx: FileSystemAccessContext,
    options?: FileReadOptions,
  ): Promise<FileReadResult>
  write(ref: FileRef, input: FileWriteInput, ctx: FileSystemAccessContext): Promise<IdeallFile>
  actions(ref: FileRef, ctx: FileSystemAccessContext): Promise<FileAction[]>
  invoke(
    ref: FileRef,
    action: string,
    input: unknown,
    ctx: FileSystemAccessContext,
  ): Promise<unknown>
  watch?(
    ref: FileRef,
    ctx: FileSystemAccessContext,
    notify: (event: FileSystemWatchEvent) => void,
  ): FileSystemWatchHandle | null
}

export type FileSystemErrorCode =
  | "not-found"
  | "permission-denied"
  | "consent-required"
  | "offline"
  | "unsupported"
  | "conflict"
  | "invalid-input"
  | "already-exists"
  | "unavailable"

export class FileSystemError extends Error {
  readonly code: FileSystemErrorCode
  readonly ref?: FileRef

  constructor(code: FileSystemErrorCode, message: string, ref?: FileRef) {
    super(message)
    this.name = "FileSystemError"
    this.code = code
    this.ref = ref
  }
}
