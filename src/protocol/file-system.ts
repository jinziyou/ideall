/**
 * Storage -> FileSystem -> File 的纯领域契约。
 *
 * 文件引用只包含文件系统实例与该实例内的不透明 id。路径、名称和目录项均为可变投影，
 * 不参与身份；同一个 FileRef 因而可以安全地出现在多个目录中。
 */

export const DIRECTORY_MEDIA_TYPE = "inode/directory"

export type FileRef = Readonly<{
  fileSystemId: string
  fileId: string
}>

export type FileKind = "file" | "directory"

export const FILE_SOURCE_KINDS = ["local", "remote", "app", "third-party", "system"] as const

export type FileSourceKind = (typeof FILE_SOURCE_KINDS)[number]

/** 物理数据来源；它描述 provenance，不承诺一套跨来源的通用 CRUD。 */
export type FileSource = {
  kind: FileSourceKind
  /** 来源内的稳定标识，例如 local、server origin、App id。 */
  id: string
  label?: string
  readOnly?: boolean
}

export const STANDARD_FILE_CAPABILITIES = [
  "read-directory",
  "read",
  "write",
  "create",
  "move",
  "delete",
  "actions",
  "watch",
  "save-to-mine",
  "standalone-window",
] as const

export type StandardFileCapability = (typeof STANDARD_FILE_CAPABILITIES)[number]

/**
 * 文件系统可声明自有 capability；标准 capability 保留补全，同时不把插件能力封死在核心枚举中。
 */
export type FileCapability = StandardFileCapability | (string & {})

export type IdeallFile = {
  ref: FileRef
  kind: FileKind
  name: string
  /** 文件使用 MIME；目录固定建议使用 inode/directory。 */
  mediaType: string
  capabilities: readonly FileCapability[]
  source: FileSource
  size?: number
  createdAt?: number
  updatedAt?: number
  /** provider 自有版本标识，可用于乐观并发。 */
  version?: string
  /** 开放元数据；不得在这里放需要额外授权的正文或二进制内容。 */
  properties?: Readonly<Record<string, unknown>>
}

export type DirectoryEntryKind = "child" | "link" | "mount"

/**
 * 目录项是独立投影而非文件身份。删除 link/mount 只移除该项，不隐含删除 target。
 * entryId 只要求在 parent 内稳定且唯一。
 */
export type DirectoryEntry = {
  entryId: string
  parent: FileRef
  target: FileRef
  name: string
  kind: DirectoryEntryKind
  sortKey?: string
  properties?: Readonly<Record<string, unknown>>
}

export function isFileRef(value: unknown): value is FileRef {
  if (value === null || typeof value !== "object") return false
  const candidate = value as Partial<FileRef>
  return (
    typeof candidate.fileSystemId === "string" &&
    candidate.fileSystemId.length > 0 &&
    typeof candidate.fileId === "string" &&
    candidate.fileId.length > 0
  )
}

export function sameFileRef(left: FileRef, right: FileRef): boolean {
  return left.fileSystemId === right.fileSystemId && left.fileId === right.fileId
}

/** 适合 Map/Set/标签身份使用的无歧义稳定 key。 */
export function fileRefKey(ref: FileRef): string {
  if (!isFileRef(ref)) throw new TypeError("FileRef requires non-empty fileSystemId and fileId")
  return `${encodeURIComponent(ref.fileSystemId)}:${encodeURIComponent(ref.fileId)}`
}

export function parseFileRefKey(raw: string | null | undefined): FileRef | null {
  if (!raw) return null
  const delimiter = raw.indexOf(":")
  if (delimiter <= 0 || delimiter === raw.length - 1 || raw.indexOf(":", delimiter + 1) >= 0) {
    return null
  }

  try {
    const ref: FileRef = {
      fileSystemId: decodeURIComponent(raw.slice(0, delimiter)),
      fileId: decodeURIComponent(raw.slice(delimiter + 1)),
    }
    return isFileRef(ref) ? ref : null
  } catch {
    return null
  }
}

/** 供手写查询字符串使用；URLSearchParams.set 会自行编码，不应再调用本函数。 */
export function fileRefQueryValue(ref: FileRef): string {
  return encodeURIComponent(fileRefKey(ref))
}

export function parseFileRefSearch(search: string): FileRef | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
  return parseFileRefKey(params.get("file"))
}
