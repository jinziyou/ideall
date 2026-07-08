import type { StoredFile } from "@protocol/files"
import type { NodeResourceRef } from "@protocol/resource"

export type FileMetaPatch = Partial<Pick<StoredFile, "name" | "tags">>
export type FileMetaActionInput = { title?: string; tags?: string[] }

export function fileResourceRef(id: string): NodeResourceRef {
  return { scheme: "node", kind: "file", id }
}

export function fileMetaActionInput(patch: FileMetaPatch): FileMetaActionInput {
  return {
    ...(patch.name !== undefined ? { title: patch.name } : {}),
    ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
  }
}
