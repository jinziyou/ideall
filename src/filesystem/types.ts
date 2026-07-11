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
  /** provider 支持时返回该目录投影下的全部后代；entry.parent 仍指向真实直接父目录。 */
  recursive?: boolean
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

export type FileReadManyOptions = FileReadOptions & {
  /** fallback 与需要逐项访问的 provider 的最大并发数；必须是有限正整数。 */
  concurrency?: number
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

export type FileActionRisk = "safe" | "caution" | "destructive"

type FileActionSchemaBase = {
  title?: string
  description?: string
}

export type FileActionStringSchema = FileActionSchemaBase & {
  type: "string"
  default?: string
  enum?: readonly string[]
  minLength?: number
  maxLength?: number
  pattern?: string
  /** binary 由 Display 转成浏览器 File；其余值保持字符串。 */
  format?: "text" | "multiline" | "password" | "uri" | "path" | "binary"
}

export type FileActionNumberSchema = FileActionSchemaBase & {
  type: "number" | "integer"
  default?: number
  minimum?: number
  maximum?: number
}

export type FileActionBooleanSchema = FileActionSchemaBase & {
  type: "boolean"
  default?: boolean
}

export type FileActionObjectSchema = FileActionSchemaBase & {
  type: "object"
  properties?: Readonly<Record<string, FileActionInputSchema>>
  required?: readonly string[]
  additionalProperties?: boolean
}

export type FileActionArraySchema = FileActionSchemaBase & {
  type: "array"
  items: FileActionInputSchema
  minItems?: number
  maxItems?: number
}

/** 可持久化并可由通用 Display 渲染的 JSON-Schema 子集。 */
export type FileActionInputSchema =
  | FileActionStringSchema
  | FileActionNumberSchema
  | FileActionBooleanSchema
  | FileActionObjectSchema
  | FileActionArraySchema

export type FileActionOutputSchema = FileActionInputSchema & {
  mediaType?: string
}

export type FileActionFieldUiHint = {
  label?: string
  placeholder?: string
  control?: "input" | "textarea" | "password" | "select" | "checkbox" | "json" | "file"
}

export type FileActionUiHints = {
  submitLabel?: string
  confirmTitle?: string
  confirmDescription?: string
  fields?: Readonly<Record<string, FileActionFieldUiHint>>
}

type FileActionBase = {
  id: string
  label: string
  /** @deprecated 新代码使用 risk:"destructive"；保留以兼容已安装的一方扩展。 */
  destructive?: boolean
  requires?: readonly FileCapability[]
  risk?: FileActionRisk
  /** true 表示在相同 FileRef、版本和输入下重复调用没有额外副作用。 */
  idempotent?: boolean
}

export type FileAction = FileActionBase &
  (
    | {
        kind: "display"
      }
    | {
        kind: "invoke"
        /** 缺省表示无参动作；存在时由通用 Display 生成输入界面。 */
        input?: FileActionInputSchema
        output?: FileActionOutputSchema
        uiHints?: FileActionUiHints
      }
    | {
        /** 输入无法安全序列化或必须由场景 UI 编排，例如 OAuth、拖拽或多步事务。 */
        kind: "specialized"
        reason?: string
      }
  )

export type FileSystemWatchEvent = {
  type: "changed" | "created" | "deleted" | "mount-changed"
  /** 实际发生变化的文件；父目录 watcher 收到子项事件时仍保留子项身份。 */
  ref: FileRef
  /** 子项在目录投影中的稳定身份（若 provider 可得）。 */
  entryId?: string
  /** 删除/移动前的直接父目录。 */
  oldParent?: FileRef
  /** 创建/移动后的直接父目录。 */
  newParent?: FileRef
  /** 变更提交后的 provider 版本，可用于跳过重复刷新。 */
  version?: string
  /** 多个子项在同一批次命中同一父目录 watcher 时的增量明细。 */
  changes?: readonly FileSystemWatchEvent[]
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
  /**
   * 可选批量读取。结果必须与 refs 一一对应且保持输入顺序；只有 not-found 用 null 表示，
   * permission-denied / consent-required / offline 等错误必须继续抛出。
   */
  readMany?(
    refs: readonly FileRef[],
    ctx: FileSystemAccessContext,
    options?: FileReadManyOptions,
  ): Promise<Array<FileReadResult | null>>
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
