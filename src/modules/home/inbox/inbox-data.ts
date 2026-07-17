import {
  CAPTURE_INBOX_TAG,
  WEB_EXCERPT_TAG,
  WEB_SNAPSHOT_TAG,
  webExcerptTextFromText,
  webSnapshotSourceFromText,
} from "@/files/web-snapshot"

export type InboxBookmarkSource = Readonly<{
  id: string
  title: string
  url: string
  description: string
  tags: readonly string[]
  createdAt: number
}>

export type InboxNoteSource = Readonly<{
  id: string
  title: string
  search: string
  tags: readonly string[]
  createdAt: number
  updatedAt: number
}>

export type InboxFileSource = Readonly<{
  id: string
  name: string
  type: string
  tags: readonly string[]
  createdAt: number
}>

export type CaptureInboxItem = Readonly<{
  id: string
  kind: "bookmark" | "note" | "file"
  captureType: "书签" | "网页快照" | "网页摘录" | "笔记" | "PDF" | "图片" | "资源"
  title: string
  summary: string
  sourceUrl: string | null
  timestamp: number
}>

function summary(text: string, limit = 240): string {
  const normalized = text.replace(/\s+/g, " ").trim()
  if (normalized.length <= limit) return normalized
  return `${normalized.slice(0, limit - 1).trimEnd()}…`
}

function noteSummary(note: InboxNoteSource): string {
  const excerpt = webExcerptTextFromText(note.search)
  if (excerpt) return summary(excerpt)
  const source = webSnapshotSourceFromText(note.search)
  const withoutSource = source ? note.search.replace(`原始来源：${source}`, "") : note.search
  const withoutCapturedAt = withoutSource.replace(/捕获时间：\S+/, "")
  return summary(withoutCapturedAt) || "已捕获的本地笔记"
}

/** 收件箱是可重建的标签投影，不复制书签、笔记或文件源数据。 */
export function buildCaptureInboxItems(
  bookmarks: readonly InboxBookmarkSource[],
  notes: readonly InboxNoteSource[],
  files: readonly InboxFileSource[] = [],
): CaptureInboxItem[] {
  const bookmarkItems: CaptureInboxItem[] = bookmarks
    .filter((bookmark) => bookmark.tags.includes(CAPTURE_INBOX_TAG))
    .map((bookmark) => ({
      id: bookmark.id,
      kind: "bookmark",
      captureType: "书签",
      title: bookmark.title || bookmark.url,
      summary: summary(bookmark.description || bookmark.url),
      sourceUrl: bookmark.url,
      timestamp: bookmark.createdAt,
    }))
  const noteItems: CaptureInboxItem[] = notes
    .filter((note) => note.tags.includes(CAPTURE_INBOX_TAG))
    .map((note) => ({
      id: note.id,
      kind: "note",
      captureType: note.tags.includes(WEB_EXCERPT_TAG)
        ? "网页摘录"
        : note.tags.includes(WEB_SNAPSHOT_TAG)
          ? "网页快照"
          : "笔记",
      title: note.title || "无标题",
      summary: noteSummary(note),
      sourceUrl: webSnapshotSourceFromText(note.search),
      timestamp: note.createdAt || note.updatedAt,
    }))
  const fileItems: CaptureInboxItem[] = files
    .filter((file) => file.tags.includes(CAPTURE_INBOX_TAG))
    .map((file) => ({
      id: file.id,
      kind: "file",
      captureType:
        file.type === "application/pdf" ? "PDF" : file.type.startsWith("image/") ? "图片" : "资源",
      title: file.name,
      summary: file.type || "本地文件",
      sourceUrl: null,
      timestamp: file.createdAt,
    }))
  return [...bookmarkItems, ...noteItems, ...fileItems].sort(
    (left, right) => right.timestamp - left.timestamp || left.title.localeCompare(right.title),
  )
}

export function withoutCaptureInboxTag(tags: readonly string[]): string[] {
  return tags.filter((tag) => tag !== CAPTURE_INBOX_TAG)
}
