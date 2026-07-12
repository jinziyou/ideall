import type { IdeallFile } from "@protocol/file-system"

export function fileTags(file: IdeallFile): string[] {
  const tags = file.properties?.tags
  return Array.isArray(tags) && tags.every((tag) => typeof tag === "string") ? [...tags] : []
}

export type TextDraftSnapshot = {
  fileKey: string
  text: string
  version?: string
}

export type TextDraftDocument = {
  fileKey: string
  base: string
  draft: string
  version?: string
  pendingExternal?: Omit<TextDraftSnapshot, "fileKey">
}

export function isTextDraftDocument(value: unknown): value is TextDraftDocument {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const document = value as Partial<TextDraftDocument>
  if (
    typeof document.fileKey !== "string" ||
    typeof document.base !== "string" ||
    typeof document.draft !== "string" ||
    (document.version !== undefined && typeof document.version !== "string")
  ) {
    return false
  }
  const pending = document.pendingExternal
  return (
    pending === undefined ||
    (pending !== null &&
      typeof pending === "object" &&
      typeof pending.text === "string" &&
      (pending.version === undefined || typeof pending.version === "string"))
  )
}

export function createTextDraftDocument(snapshot: TextDraftSnapshot): TextDraftDocument {
  return {
    fileKey: snapshot.fileKey,
    base: snapshot.text,
    draft: snapshot.text,
    version: snapshot.version,
  }
}

/** 合并文件系统刷新：干净文档直接重载，脏草稿保留并暂存外部版本。 */
export function reconcileTextDraft(
  current: TextDraftDocument,
  incoming: TextDraftSnapshot,
): TextDraftDocument {
  if (current.fileKey !== incoming.fileKey || current.draft === current.base) {
    return createTextDraftDocument(incoming)
  }
  if (incoming.text === current.draft) return createTextDraftDocument(incoming)
  if (incoming.text === current.base) {
    return { ...current, version: incoming.version, pendingExternal: undefined }
  }
  return {
    ...current,
    pendingExternal: { text: incoming.text, version: incoming.version },
  }
}

export function editTextDraft(current: TextDraftDocument, draft: string): TextDraftDocument {
  if (current.pendingExternal?.text === draft) {
    return createTextDraftDocument({
      fileKey: current.fileKey,
      text: draft,
      version: current.pendingExternal.version,
    })
  }
  if (current.draft === draft) return current
  return { ...current, draft }
}

export function acceptExternalTextDraft(current: TextDraftDocument): TextDraftDocument {
  return current.pendingExternal
    ? createTextDraftDocument({ fileKey: current.fileKey, ...current.pendingExternal })
    : current
}

export function markTextDraftSaved(
  current: TextDraftDocument,
  savedDraft: string,
  version?: string,
): TextDraftDocument {
  return {
    ...current,
    base: savedDraft,
    version,
    pendingExternal: undefined,
  }
}
