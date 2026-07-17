import type { NewNote } from "@protocol/files"
import type { CaptureBookmarkInput, CaptureBookmarkResult } from "@protocol/capture"
import {
  buildWebExcerptDocument,
  buildWebSnapshotDocument,
  CAPTURE_INBOX_TAG,
  normalizeWebExcerpt,
  WEB_EXCERPT_TAG,
  WEB_SNAPSHOT_OFFLINE_TAG,
  WEB_SNAPSHOT_TAG,
  webExcerptTextFromText,
  webSnapshotSourceFromText,
} from "@/files/web-snapshot"
import { createNoteFile, listNoteFiles, type FileNote } from "@/modules/home/notes/note-file-system"
import { canonicalHttpUrl as canonicalHttpUrlValue } from "@/lib/canonical-http-url"
import { recordFirstCreatedCapture } from "@/lib/capture-onboarding"
import { browserGetPageContent, type BrowserPageContent } from "@/lib/tauri"
import { captureBookmarkToMine } from "@/filesystem/capture-bookmark"

const DESCRIPTION_LIMIT = 320

export type BrowserCaptureResult = Readonly<{
  status: "created" | "existing"
  title: string
  url: string
  description: string
}>

export type BrowserCaptureDeps = Readonly<{
  getPageContent: () => Promise<BrowserPageContent>
  captureBookmark: (input: CaptureBookmarkInput) => Promise<CaptureBookmarkResult>
}>

export type BrowserSnapshotResult = Readonly<{
  status: "created" | "existing"
  title: string
  url: string
  bodyCharacters: number
  truncated: boolean
}>

export type BrowserExcerptResult = BrowserSnapshotResult & Readonly<{ excerpt: string }>

export type BrowserSnapshotDeps = Readonly<{
  getPageContent: () => Promise<BrowserPageContent>
  listNotes: () => Promise<readonly Pick<FileNote, "title" | "tags" | "search">[]>
  createNote: (input: Pick<NewNote, "title" | "content" | "tags">) => Promise<void>
  now: () => number
}>

function canonicalHttpUrl(raw: string): string {
  const canonical = canonicalHttpUrlValue(raw)
  if (!canonical) throw new Error("当前页面不是可收藏的 HTTP(S) 地址")
  return canonical
}

export function browserCaptureDescription(text: string, limit = DESCRIPTION_LIMIT): string {
  if (!Number.isSafeInteger(limit) || limit < 1) return ""
  const normalized = text.replace(/\s+/g, " ").trim()
  if (normalized.length <= limit) return normalized
  return `${normalized.slice(0, Math.max(1, limit - 1)).trimEnd()}…`
}

function fallbackTitle(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, "")
    return host || url
  } catch {
    return url
  }
}

const DEFAULT_DEPS: BrowserCaptureDeps = {
  getPageContent: browserGetPageContent,
  captureBookmark: captureBookmarkToMine,
}

const DEFAULT_SNAPSHOT_DEPS: BrowserSnapshotDeps = {
  getPageContent: browserGetPageContent,
  listNotes() {
    return listNoteFiles(true)
  },
  async createNote(input) {
    await createNoteFile(null, input)
  },
  now: Date.now,
}

/**
 * 把原生浏览器当前页保存为普通 bookmark Node。
 *
 * 正文只生成有界摘要；需要离线正文时由 captureCurrentBrowserSnapshot 单独写入笔记。
 * 同一 canonical URL 幂等返回 existing，避免用户重复点击产生多份书签。
 */
export async function captureCurrentBrowserPage(
  deps: BrowserCaptureDeps = DEFAULT_DEPS,
): Promise<BrowserCaptureResult> {
  const page = await deps.getPageContent()
  const url = page.url.trim()
  canonicalHttpUrl(url)
  const title = page.title.trim() || fallbackTitle(url)
  const description = browserCaptureDescription(page.text)
  const result = await deps.captureBookmark({ title, url, description })
  return {
    status: result.status,
    title: result.bookmark.title || title,
    url: result.bookmark.url,
    description: result.bookmark.description || description,
  }
}

/**
 * 把当前页正文保存为普通本地笔记。来源标记参与 canonical URL 去重，正文自动进入笔记全文搜索。
 */
export async function captureCurrentBrowserSnapshot(
  deps: BrowserSnapshotDeps = DEFAULT_SNAPSHOT_DEPS,
): Promise<BrowserSnapshotResult> {
  const page = await deps.getPageContent()
  const url = page.url.trim()
  const canonical = canonicalHttpUrl(url)
  const title = page.title.trim() || fallbackTitle(url)
  const notes = await deps.listNotes()
  const existing = notes.find((note) => {
    if (!note.tags.includes(WEB_SNAPSHOT_TAG)) return false
    const source = webSnapshotSourceFromText(note.search)
    if (!source) return false
    try {
      return canonicalHttpUrl(source) === canonical
    } catch {
      return false
    }
  })
  if (existing) {
    return {
      status: "existing",
      title: existing.title || title,
      url,
      bodyCharacters: 0,
      truncated: false,
    }
  }

  const snapshot = buildWebSnapshotDocument({ url, text: page.text, capturedAt: deps.now() })
  await deps.createNote({
    title,
    content: snapshot.content,
    tags: [WEB_SNAPSHOT_TAG, WEB_SNAPSHOT_OFFLINE_TAG, CAPTURE_INBOX_TAG],
  })
  recordFirstCreatedCapture()
  return {
    status: "created",
    title,
    url: snapshot.sourceUrl,
    bodyCharacters: snapshot.bodyCharacters,
    truncated: snapshot.truncated,
  }
}

/** 把当前选区保存为可编辑笔记；同来源、同文本幂等，来源相同但选区不同可分别保存。 */
export async function captureCurrentBrowserExcerpt(
  deps: BrowserSnapshotDeps = DEFAULT_SNAPSHOT_DEPS,
): Promise<BrowserExcerptResult> {
  const page = await deps.getPageContent()
  const url = page.url.trim()
  const canonical = canonicalHttpUrl(url)
  const pageTitle = page.title.trim() || fallbackTitle(url)
  const title = `${pageTitle} · 摘录`
  const excerpt = buildWebExcerptDocument({
    url,
    selection: page.selection,
    capturedAt: deps.now(),
  })
  const normalizedExcerpt = normalizeWebExcerpt(excerpt.excerpt)
  const notes = await deps.listNotes()
  const existing = notes.find((note) => {
    if (!note.tags.includes(WEB_EXCERPT_TAG)) return false
    const source = webSnapshotSourceFromText(note.search)
    const existingExcerpt = webExcerptTextFromText(note.search)
    if (!source || !existingExcerpt || existingExcerpt !== normalizedExcerpt) return false
    try {
      return canonicalHttpUrl(source) === canonical
    } catch {
      return false
    }
  })
  if (existing) {
    return {
      status: "existing",
      title: existing.title || title,
      url,
      excerpt: normalizedExcerpt,
      bodyCharacters: normalizedExcerpt.length,
      truncated: excerpt.truncated,
    }
  }

  await deps.createNote({
    title,
    content: excerpt.content,
    tags: [WEB_EXCERPT_TAG, CAPTURE_INBOX_TAG],
  })
  recordFirstCreatedCapture()
  return {
    status: "created",
    title,
    url: excerpt.sourceUrl,
    excerpt: normalizedExcerpt,
    bodyCharacters: excerpt.bodyCharacters,
    truncated: excerpt.truncated,
  }
}
