import { MAX_ENGINE_SUSPEND_SNAPSHOT_BYTES } from "../engine-suspension"

export type FileDraftSnapshot = {
  base: string
  draft: string
  fileName: string
  updatedAt: number
}

const FILE_DRAFT_PREFIX = "ideall:file-draft:"

export function readFileDraft(fileId: string): FileDraftSnapshot | null {
  if (typeof sessionStorage === "undefined") return null
  try {
    const raw = sessionStorage.getItem(draftKey(fileId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<FileDraftSnapshot>
    if (typeof parsed.base !== "string" || typeof parsed.draft !== "string") return null
    return {
      base: parsed.base,
      draft: parsed.draft,
      fileName: typeof parsed.fileName === "string" ? parsed.fileName : "",
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
    }
  } catch {
    return null
  }
}

export function writeFileDraft(fileId: string, draft: FileDraftSnapshot): boolean {
  if (typeof sessionStorage === "undefined") return false
  try {
    const serialized = JSON.stringify(draft)
    if (serialized.length > MAX_ENGINE_SUSPEND_SNAPSHOT_BYTES) {
      sessionStorage.removeItem(draftKey(fileId))
      return false
    }
    sessionStorage.setItem(draftKey(fileId), serialized)
    return true
  } catch {
    // 配额满或隐私模式下放弃草稿持久化, 编辑器内存草稿仍在。
    try {
      sessionStorage.removeItem(draftKey(fileId))
    } catch {}
    return false
  }
}

export function clearFileDraft(fileId: string): void {
  if (typeof sessionStorage === "undefined") return
  try {
    sessionStorage.removeItem(draftKey(fileId))
  } catch {
    // ignore
  }
}

function draftKey(fileId: string): string {
  return `${FILE_DRAFT_PREFIX}${fileId}`
}
