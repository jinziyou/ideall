import type { DirectoryEntry, FileRef, IdeallFile } from "@protocol/file-system"
import { fileSystemRegistry, type FileSystemRegistry } from "./registry"
import { IDEALL_ROOT_REF } from "./root-ref"
import { FileSystemError, type FileSystemAccessContext } from "./types"

const MAX_PATH_LENGTH = 4_096
const MAX_PATH_DEPTH = 64
const MAX_PATH_NAME_LENGTH = 255
const DIRECTORY_PAGE_LIMIT = 128

/** 从 ideall 隐藏根出发的规范绝对路径。它是目录投影位置，不是 IdeallFile 身份。 */
export type IdeallPath = `/${string}`

export type ResolvedIdeallPath = Readonly<{
  path: IdeallPath
  ref: FileRef
  file: IdeallFile
  /** 从隐藏根到目标的目录项链；根路径为空。 */
  entries: readonly DirectoryEntry[]
}>

export type FileSystemPathReader = Pick<FileSystemRegistry, "readDirectory" | "stat">

function invalidPath(message: string): never {
  throw new FileSystemError("invalid-input", `Invalid ideall path: ${message}`)
}

export function isIdeallPathName(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_PATH_NAME_LENGTH &&
    value !== "." &&
    value !== ".." &&
    !/[\u0000-\u001f\u007f/\\]/.test(value)
  )
}

/**
 * 规范化绝对路径；`.` 与重复分隔符会折叠，`..` 只能回到隐藏根以内。
 * URL query/hash 不属于文件系统路径，必须由调用方在进入本层前剥离。
 */
export function normalizeIdeallPath(value: string): IdeallPath {
  if (!value.startsWith("/")) invalidPath("path must be absolute")
  if (value.length > MAX_PATH_LENGTH) invalidPath(`path exceeds ${MAX_PATH_LENGTH} characters`)
  if (value.includes("?") || value.includes("#")) {
    invalidPath("query strings and fragments are not path components")
  }

  const segments: string[] = []
  for (const segment of value.split("/")) {
    if (!segment || segment === ".") continue
    if (segment === "..") {
      if (segments.length === 0) invalidPath("path escapes the root")
      segments.pop()
      continue
    }
    if (!isIdeallPathName(segment)) invalidPath(`invalid component ${JSON.stringify(segment)}`)
    segments.push(segment)
    if (segments.length > MAX_PATH_DEPTH) {
      invalidPath(`path exceeds ${MAX_PATH_DEPTH} components`)
    }
  }
  return (segments.length === 0 ? "/" : `/${segments.join("/")}`) as IdeallPath
}

export function ideallPathSegments(path: string): readonly string[] {
  const normalized = normalizeIdeallPath(path)
  return normalized === "/" ? [] : normalized.slice(1).split("/")
}

export function joinIdeallPath(parent: string, pathName: string): IdeallPath {
  if (!isIdeallPathName(pathName)) invalidPath(`invalid component ${JSON.stringify(pathName)}`)
  const normalizedParent = normalizeIdeallPath(parent)
  return normalizeIdeallPath(`${normalizedParent === "/" ? "" : normalizedParent}/${pathName}`)
}

async function pathEntry(
  reader: FileSystemPathReader,
  parent: FileRef,
  pathName: string,
  ctx: FileSystemAccessContext,
): Promise<DirectoryEntry | null> {
  let cursor: string | undefined
  const seenCursors = new Set<string>()
  let match: DirectoryEntry | null = null

  do {
    const page = await reader.readDirectory(
      parent,
      { ...ctx, intent: "directory" },
      {
        cursor,
        limit: DIRECTORY_PAGE_LIMIT,
      },
    )
    for (const entry of page.entries) {
      if (entry.pathName !== pathName) continue
      if (match) {
        throw new FileSystemError(
          "conflict",
          `Directory contains duplicate path component ${JSON.stringify(pathName)}`,
          parent,
        )
      }
      match = entry
    }

    const next = page.nextCursor
    if (next === undefined) break
    if (seenCursors.has(next) || next === cursor) {
      throw new FileSystemError("unavailable", "Directory provider repeated a cursor", parent)
    }
    seenCursors.add(next)
    cursor = next
  } while (true)

  return match
}

/**
 * 逐级读取 DirectoryEntry 并跟随 link/mount target。路径不会绕过 registry 或访问上下文，
 * dangling link 与不存在的文件统一返回 null。
 */
export async function resolveFileSystemPath(
  reader: FileSystemPathReader,
  root: FileRef,
  path: string,
  ctx: FileSystemAccessContext,
): Promise<ResolvedIdeallPath | null> {
  const normalized = normalizeIdeallPath(path)
  const entries: DirectoryEntry[] = []
  let ref = root

  for (const segment of ideallPathSegments(normalized)) {
    const parent = await reader.stat(ref, { ...ctx, intent: "metadata" })
    if (!parent) return null
    if (parent.kind !== "directory") return null
    const next = await pathEntry(reader, ref, segment, ctx)
    if (!next) return null
    entries.push(next)
    ref = next.target
  }

  const file = await reader.stat(ref, { ...ctx, intent: "metadata" })
  return file ? { path: normalized, ref, file, entries } : null
}

export function resolveIdeallPath(
  path: string,
  ctx: FileSystemAccessContext,
): Promise<ResolvedIdeallPath | null> {
  return resolveFileSystemPath(fileSystemRegistry, IDEALL_ROOT_REF, path, ctx)
}
