import type { StoredFile } from "@protocol/files"

export type FileMetaPatch = Partial<Pick<StoredFile, "name" | "tags">>
export type FileMetaActionInput = { title?: string; tags?: string[] }

export function fileMetaActionInput(patch: FileMetaPatch): FileMetaActionInput {
  return {
    ...(patch.name !== undefined ? { title: patch.name } : {}),
    ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
  }
}

export function parseFileTags(input: string): string[] {
  const seen = new Set<string>()
  const tags: string[] = []
  for (const raw of input.split(/[,，\n]/)) {
    const tag = raw.trim()
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    tags.push(tag)
  }
  return tags
}

export function fileReference(id: string): string {
  return `fs://file/${id}`
}
