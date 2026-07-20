import type { DirectoryEntry, FileKind } from "@protocol/file-system"

function boundedHint(value: unknown): string | undefined {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= 160 &&
    value === value.trim()
    ? value
    : undefined
}

/** link 可覆盖该目录位置的默认打开方式，但最终仍须由 Engine matcher 验证。 */
export function directoryEntryPreferredEngine(
  entry: DirectoryEntry | null | undefined,
): string | undefined {
  return boundedHint(entry?.properties?.preferredEngine)
}

export function directoryEntryIconHint(
  entry: DirectoryEntry | null | undefined,
): string | undefined {
  return boundedHint(entry?.properties?.iconHint)
}

/** stat 前可用于稳定骨架；不能代替目标 FileSystem 返回的权威 kind。 */
export function directoryEntryTargetKindHint(
  entry: DirectoryEntry | null | undefined,
): FileKind | undefined {
  const value = entry?.properties?.targetKind
  return value === "file" || value === "directory" ? value : undefined
}
