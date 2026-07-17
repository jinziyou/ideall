import type { NoteContent } from "@protocol/files"
import { safeHref } from "@/lib/safe-url"

export const WEB_SNAPSHOT_TAG = "网页快照"
export const WEB_SNAPSHOT_OFFLINE_TAG = "离线"
export const WEB_EXCERPT_TAG = "网页摘录"
export { CAPTURE_INBOX_TAG } from "@protocol/capture"
export const WEB_SNAPSHOT_SOURCE_PREFIX = "原始来源："
export const WEB_SNAPSHOT_CAPTURED_AT_PREFIX = "捕获时间："
export const WEB_EXCERPT_CONTENT_PREFIX = "摘录："

export const WEB_SNAPSHOT_TEXT_LIMIT = 80_000
export const WEB_EXCERPT_TEXT_LIMIT = 20_000
const WEB_SNAPSHOT_BLOCK_LIMIT = 160
const WEB_SNAPSHOT_BLOCK_TEXT_LIMIT = 2_000
const WEB_EXCERPT_TRUNCATION_MESSAGE = "（选中文本过长，摘录已按本地存储上限截断）"

type ParagraphBlock = Readonly<{
  type: "p"
  children: readonly Readonly<{ text: string }>[]
}>

type BlockquoteBlock = Readonly<{
  type: "blockquote"
  children: readonly ParagraphBlock[]
}>

export type WebSnapshotDocument = Readonly<{
  content: NoteContent
  sourceUrl: string
  capturedAt: number
  bodyCharacters: number
  truncated: boolean
}>

export type WebSnapshotMetadata = Readonly<{
  sourceUrl: string
  capturedAt: number | null
}>

export type WebExcerptDocument = WebSnapshotDocument & Readonly<{ excerpt: string }>

function paragraph(text: string): ParagraphBlock {
  return { type: "p", children: [{ text }] }
}

function blockquote(text: string): BlockquoteBlock {
  return { type: "blockquote", children: [paragraph(text)] }
}

function normalizedParagraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .trim()
    .split(/\n\s*\n+/)
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter(Boolean)
}

function splitParagraph(text: string): string[] {
  const chunks: string[] = []
  for (let offset = 0; offset < text.length; offset += WEB_SNAPSHOT_BLOCK_TEXT_LIMIT) {
    chunks.push(text.slice(offset, offset + WEB_SNAPSHOT_BLOCK_TEXT_LIMIT))
  }
  return chunks
}

/** 构造可由普通笔记编辑器读取的离线网页正文；大小和块数均有硬上限。 */
export function buildWebSnapshotDocument(
  input: Readonly<{ url: string; text: string; capturedAt?: number; textLimit?: number }>,
): WebSnapshotDocument {
  const sourceUrl = safeHref(input.url)
  if (!sourceUrl) throw new Error("当前页面不是可保存快照的 HTTP(S) 地址")

  const capturedAt = input.capturedAt ?? Date.now()
  if (!Number.isFinite(capturedAt)) throw new Error("快照捕获时间无效")
  const requestedLimit = input.textLimit ?? WEB_SNAPSHOT_TEXT_LIMIT
  const textLimit =
    Number.isSafeInteger(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, WEB_SNAPSHOT_TEXT_LIMIT)
      : WEB_SNAPSHOT_TEXT_LIMIT
  const normalized = input.text.replace(/\r\n?/g, "\n").trim()
  const bounded = normalized.slice(0, textLimit)
  const body: ParagraphBlock[] = []
  let blockOverflow = false

  for (const value of normalizedParagraphs(bounded)) {
    for (const chunk of splitParagraph(value)) {
      if (body.length >= WEB_SNAPSHOT_BLOCK_LIMIT) {
        blockOverflow = true
        break
      }
      body.push(paragraph(chunk))
    }
    if (blockOverflow) break
  }

  const truncated = normalized.length > bounded.length || blockOverflow
  const content: NoteContent = [
    paragraph(`${WEB_SNAPSHOT_SOURCE_PREFIX}${sourceUrl}`),
    paragraph(`${WEB_SNAPSHOT_CAPTURED_AT_PREFIX}${new Date(capturedAt).toISOString()}`),
    paragraph(""),
    ...(body.length > 0 ? body : [paragraph("（页面未返回可读正文）")]),
    ...(truncated ? [paragraph("（正文过长，快照已按本地存储上限截断）")] : []),
  ]

  return {
    content,
    sourceUrl,
    capturedAt,
    bodyCharacters: body.reduce((total, block) => total + block.children[0]!.text.length, 0),
    truncated,
  }
}

export function normalizeWebExcerpt(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

/** 构造带来源引用的网页摘录；选区为空时拒绝创建，避免把整页误存为摘录。 */
export function buildWebExcerptDocument(
  input: Readonly<{ url: string; selection: string; capturedAt?: number }>,
): WebExcerptDocument {
  const sourceUrl = safeHref(input.url)
  if (!sourceUrl) throw new Error("当前页面不是可保存摘录的 HTTP(S) 地址")
  const selection = normalizeWebExcerpt(input.selection)
  if (!selection) throw new Error("请先在页面中选择要保存的文字")
  const excerpt = selection.slice(0, WEB_EXCERPT_TEXT_LIMIT)
  const truncated = selection.length > excerpt.length
  const capturedAt = input.capturedAt ?? Date.now()
  const capturedDate = new Date(capturedAt)
  if (!Number.isFinite(capturedDate.getTime())) throw new Error("摘录捕获时间无效")
  const quoted = splitParagraph(excerpt).map(blockquote)
  const content: NoteContent = [
    paragraph(`${WEB_SNAPSHOT_SOURCE_PREFIX}${sourceUrl}`),
    paragraph(`${WEB_SNAPSHOT_CAPTURED_AT_PREFIX}${capturedDate.toISOString()}`),
    paragraph(""),
    paragraph(WEB_EXCERPT_CONTENT_PREFIX),
    ...quoted,
    ...(truncated ? [paragraph(WEB_EXCERPT_TRUNCATION_MESSAGE)] : []),
  ]
  return {
    content,
    sourceUrl,
    capturedAt,
    bodyCharacters: excerpt.length,
    truncated,
    excerpt,
  }
}

export function webSnapshotSourceFromText(text: string): string | null {
  const index = text.indexOf(WEB_SNAPSHOT_SOURCE_PREFIX)
  if (index < 0) return null
  const raw = text.slice(index + WEB_SNAPSHOT_SOURCE_PREFIX.length).match(/^\S+/)?.[0]
  return safeHref(raw) ?? null
}

/** 恢复由 buildWebExcerptDocument 创建的规范摘录文本，用于幂等检测。 */
export function webExcerptTextFromText(text: string): string | null {
  const index = text.indexOf(WEB_EXCERPT_CONTENT_PREFIX)
  if (index < 0) return null
  const tail = normalizeWebExcerpt(text.slice(index + WEB_EXCERPT_CONTENT_PREFIX.length))
  const excerpt = tail.endsWith(WEB_EXCERPT_TRUNCATION_MESSAGE)
    ? tail.slice(0, -WEB_EXCERPT_TRUNCATION_MESSAGE.length).trimEnd()
    : tail
  return excerpt || null
}

function contentText(content: NoteContent): string {
  const parts: string[] = []
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return
    const value = node as { text?: unknown; children?: unknown }
    if (typeof value.text === "string") parts.push(value.text)
    if (Array.isArray(value.children)) value.children.forEach(visit)
  }
  content.forEach(visit)
  return parts.join(" ")
}

/** 从可编辑的快照笔记中恢复来源信息；用户删除标记后会自然退化为普通笔记。 */
export function webSnapshotMetadata(content: NoteContent): WebSnapshotMetadata | null {
  const text = contentText(content)
  const sourceUrl = webSnapshotSourceFromText(text)
  if (!sourceUrl) return null
  const capturedIndex = text.indexOf(WEB_SNAPSHOT_CAPTURED_AT_PREFIX)
  const capturedRaw =
    capturedIndex < 0
      ? null
      : (text.slice(capturedIndex + WEB_SNAPSHOT_CAPTURED_AT_PREFIX.length).match(/^\S+/)?.[0] ??
        null)
  const capturedAt = capturedRaw ? Date.parse(capturedRaw) : Number.NaN
  return { sourceUrl, capturedAt: Number.isFinite(capturedAt) ? capturedAt : null }
}
