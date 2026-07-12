import type { ResourceMeta } from "@protocol/resource"
import type { ResourcePage } from "./types"

export function matchesResourceText(meta: ResourceMeta, text: string | undefined): boolean {
  const normalizedText = text?.trim().toLocaleLowerCase()
  return !normalizedText || meta.title.toLocaleLowerCase().includes(normalizedText)
}

export function paginateResourceMeta(
  items: ResourceMeta[],
  limit: number | undefined,
  cursor: string | undefined,
): ResourcePage {
  const parsedOffset = cursor == null ? 0 : Number.parseInt(cursor, 10)
  const offset = Number.isFinite(parsedOffset) && parsedOffset > 0 ? parsedOffset : 0
  const pageLimit = limit != null && limit > 0 ? Math.floor(limit) : items.length
  const nextOffset = offset + pageLimit
  return {
    items: items.slice(offset, nextOffset),
    nextCursor: nextOffset < items.length ? String(nextOffset) : undefined,
  }
}
