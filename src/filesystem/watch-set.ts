import { fileRefKey, type FileRef } from "@protocol/file-system"
import { watchFile } from "./registry"
import type { FileSystemAccessContext, FileSystemWatchEvent, FileSystemWatchHandle } from "./types"

/** 将多个 provider watch 组合成一个句柄；不支持 watch 的来源不会影响其余订阅。 */
export function watchFileSet(
  refs: readonly FileRef[],
  ctx: FileSystemAccessContext,
  notify: (event: FileSystemWatchEvent) => void,
): FileSystemWatchHandle | null {
  const handles: FileSystemWatchHandle[] = []
  const seen = new Set<string>()
  for (const ref of refs) {
    const key = fileRefKey(ref)
    if (seen.has(key)) continue
    seen.add(key)
    try {
      const handle = watchFile(ref, ctx, notify)
      if (handle) handles.push(handle)
    } catch {
      // watch 是可选能力；一次不支持不应撤销其他来源的有效订阅。
    }
  }
  if (handles.length === 0) return null
  return {
    dispose() {
      for (const handle of handles.splice(0)) handle.dispose()
    },
  }
}
