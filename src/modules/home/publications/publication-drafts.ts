import type { FileRef, IdeallFile } from "@protocol/file-system"
import type { NoteContent } from "@protocol/files"
import type { NodeOfKind } from "@protocol/node"
import type { Publication } from "@protocol/peer"
import { deletePublication, publish } from "@protocol/peer"
import { noteText } from "@/files/note-text"
import {
  WEB_EXCERPT_TAG,
  WEB_SNAPSHOT_CAPTURED_AT_PREFIX,
  WEB_SNAPSHOT_SOURCE_PREFIX,
  WEB_SNAPSHOT_TAG,
  webExcerptTextFromText,
  webSnapshotSourceFromText,
} from "@/files/web-snapshot"
import {
  AGENT_AUDIT_APPEND_ACTION,
  AGENT_AUDIT_COMPLETE_ACTION,
  AGENT_AUDIT_FILE_REF,
} from "@/filesystem/builtin-app-roots"
import { invokeFileAction, readFile } from "@/filesystem/registry"
import { resourceFileRef, resourceRefForFile } from "@/filesystem/resource-file-system"
import type { FileSystemAccessContext } from "@/filesystem/types"
import { mapConcurrentOrdered } from "@/lib/map-concurrent-ordered"
import { safeHref } from "@/lib/safe-url"
import { listBookmarkFiles, type FileBookmark } from "@/modules/home/bookmarks/bookmark-file-system"
import { createNoteFile, listNoteFiles, type FileNote } from "@/modules/home/notes/note-file-system"

export const COMMUNITY_DRAFT_TAG = "社区草稿"
export const COMMUNITY_PUBLISHED_TAG = "社区发布"
export const COMMUNITY_DRAFT_METADATA_KEY = "ideallPublicationDraft"

export const MAX_PUBLICATION_DRAFT_TITLE = 200
export const MAX_PUBLICATION_DRAFT_URL = 2_048
export const MAX_PUBLICATION_DRAFT_BODY = 20_000
export const MAX_PUBLICATION_DRAFT_SOURCES = 200

const MAX_PUBLICATION_DRAFT_BLOCKS = 256
const PUBLICATION_DRAFT_READ_CONCURRENCY = 8
const MAX_ORIGIN_ID = 512
const MAX_ORIGIN_TITLE = 200
const MAX_ORIGIN_VERSION = 512

const READ_CONTEXT = {
  actor: "ui",
  permissions: [],
  intent: "content",
} as const satisfies FileSystemAccessContext

const ACTION_CONTEXT = {
  actor: "ui",
  permissions: [],
  intent: "action",
} as const satisfies FileSystemAccessContext

type PublicationDraftStatus = "draft" | "published"

export type PublicationDraftOriginKind = "note" | "bookmark" | "browser-capture"

export type PublicationDraftOrigin = Readonly<{
  kind: PublicationDraftOriginKind
  id: string
  title: string
  version: string | null
}>

export type PublicationDraftInput = Readonly<{
  title: string
  url: string
  body: string
}>

export type PublicationDraft = PublicationDraftInput &
  Readonly<{
    id: string
    ref: FileRef
    version: string | null
    status: PublicationDraftStatus
    origin?: PublicationDraftOrigin
    remotePublicationId?: number
    publishedAt?: number
    createdAt: number
    updatedAt: number
    tags: readonly string[]
  }>

export type PublicationDraftSource = PublicationDraftInput &
  Readonly<{
    key: string
    kind: PublicationDraftOriginKind
    id: string
    version: string | null
    updatedAt: number
    description: string
    truncated: boolean
  }>

type PublicationDraftMetadata = Readonly<{
  version: 1
  status: PublicationDraftStatus
  url: string
  origin?: PublicationDraftOrigin
  remotePublicationId?: number
  publishedAt?: number
}>

type PublicationAuditInput = Readonly<{
  source: "tool"
  operation: string
  title: string
  summary: string
  status: "pending"
  effect: "external"
  risk: "high"
  target: Readonly<{ kind: string; id: string; label: string }>
}>

type PublicationDraftStorageDeps = Readonly<{
  listNotes(includeText?: boolean): Promise<FileNote[]>
  listBookmarks(): Promise<{ bookmarks: FileBookmark[] }>
  readNote(ref: FileRef): Promise<{ data: unknown; version?: string }>
  createNote(input: { title: string; content: NoteContent; tags: string[] }): Promise<IdeallFile>
  editNote(
    ref: FileRef,
    input: { title: string; content: NoteContent; tags: string[] },
    expectedVersion: string | null,
  ): Promise<unknown>
  deleteNote(ref: FileRef, expectedVersion: string | null): Promise<unknown>
  now(): number
}>

type PublicationWorkflowDeps = Readonly<{
  publishRemote: typeof publish
  deleteRemote: typeof deletePublication
  beginAudit(input: PublicationAuditInput): Promise<string>
  completeAudit(input: {
    id: string
    status: "committed" | "failed"
    summary: string
  }): Promise<void>
  archiveDraft(draft: PublicationDraft, publication: Publication | null): Promise<PublicationDraft>
}>

export type PublicationPublishOutcome =
  | Readonly<{
      status: "published"
      publication: Publication | null
      auditPending: boolean
      archivePending: boolean
    }>
  | Readonly<{ status: "failed"; message: string }>
  | Readonly<{ status: "unknown"; message: string }>

export type PublicationDeleteOutcome =
  | Readonly<{ status: "deleted"; auditPending: boolean }>
  | Readonly<{ status: "failed"; message: string }>
  | Readonly<{ status: "unknown"; message: string }>

export type CommunityMutationGuards = Readonly<{
  pendingDraftIds: readonly string[]
  publishedDraftIds: readonly string[]
  pendingPublicationIds: readonly number[]
}>

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function text(value: unknown, maximum: number): string | null {
  if (typeof value !== "string" || value.length > maximum) return null
  return value
}

function normalizeTitle(value: string): string {
  const title = value.replace(/[\u0000-\u001f\u007f]+/gu, " ").trim()
  if (!title) throw new TypeError("发布标题不能为空")
  if (title.length > MAX_PUBLICATION_DRAFT_TITLE) {
    throw new TypeError(`发布标题最多允许 ${MAX_PUBLICATION_DRAFT_TITLE} 个字符`)
  }
  return title
}

function normalizeUrl(value: string): string {
  const url = value.trim()
  if (!url) return ""
  if (url.length > MAX_PUBLICATION_DRAFT_URL) {
    throw new TypeError(`发布链接最多允许 ${MAX_PUBLICATION_DRAFT_URL} 个字符`)
  }
  const safe = safeHref(url)
  if (!safe) throw new TypeError("发布链接必须是有效的 HTTP(S) 地址")
  return safe
}

function normalizeBody(value: string): string {
  const body = value.replace(/\r\n?/gu, "\n").trim()
  if (body.length > MAX_PUBLICATION_DRAFT_BODY) {
    throw new TypeError(`发布正文最多允许 ${MAX_PUBLICATION_DRAFT_BODY} 个字符`)
  }
  return body
}

export function normalizePublicationDraftInput(
  input: PublicationDraftInput,
): PublicationDraftInput {
  return {
    title: normalizeTitle(input.title),
    url: normalizeUrl(input.url),
    body: normalizeBody(input.body),
  }
}

function normalizeOrigin(
  origin: PublicationDraftOrigin | undefined,
): PublicationDraftOrigin | null {
  if (!origin) return null
  if (!(["note", "bookmark", "browser-capture"] as const).includes(origin.kind)) return null
  const id = text(origin.id, MAX_ORIGIN_ID)?.trim()
  const title = text(origin.title, MAX_ORIGIN_TITLE)?.trim()
  const version = origin.version === null ? null : text(origin.version, MAX_ORIGIN_VERSION)
  if (!id || !title || (version === null && origin.version !== null)) return null
  return { kind: origin.kind, id, title, version }
}

function paragraph(value: string, metadata?: PublicationDraftMetadata): Record<string, unknown> {
  return {
    type: "p",
    children: [{ text: value }],
    ...(metadata ? { [COMMUNITY_DRAFT_METADATA_KEY]: metadata } : {}),
  }
}

function bodyParagraphs(body: string): Record<string, unknown>[] {
  const chunks = body ? body.split(/\n{2,}/u) : [""]
  if (chunks.length <= MAX_PUBLICATION_DRAFT_BLOCKS) return chunks.map((chunk) => paragraph(chunk))
  const head = chunks.slice(0, MAX_PUBLICATION_DRAFT_BLOCKS - 1)
  const tail = chunks.slice(MAX_PUBLICATION_DRAFT_BLOCKS - 1).join("\n\n")
  return [...head, tail].map((chunk) => paragraph(chunk))
}

export function publicationDraftContent(
  input: PublicationDraftInput,
  options: Readonly<{
    origin?: PublicationDraftOrigin
    status?: PublicationDraftStatus
    remotePublicationId?: number
    publishedAt?: number
  }> = {},
): NoteContent {
  const normalized = normalizePublicationDraftInput(input)
  const origin = normalizeOrigin(options.origin)
  const metadata: PublicationDraftMetadata = {
    version: 1,
    status: options.status ?? "draft",
    url: normalized.url,
    ...(origin ? { origin } : {}),
    ...(Number.isSafeInteger(options.remotePublicationId) && options.remotePublicationId! >= 0
      ? { remotePublicationId: options.remotePublicationId }
      : {}),
    ...(typeof options.publishedAt === "number" && Number.isFinite(options.publishedAt)
      ? { publishedAt: options.publishedAt }
      : {}),
  }
  return [paragraph("", metadata), ...bodyParagraphs(normalized.body)]
}

function blockText(value: unknown): string {
  if (!isRecord(value)) return ""
  const parts: string[] = []
  if (typeof value.text === "string") parts.push(value.text)
  if (Array.isArray(value.children)) {
    for (const child of value.children) parts.push(blockText(child))
  }
  return parts.join("")
}

function bodyFromDraftContent(content: NoteContent): string {
  return content.slice(1).map(blockText).join("\n\n").trim()
}

function decodeDraftMetadata(content: NoteContent): PublicationDraftMetadata | null {
  const first = content[0]
  if (!isRecord(first) || !isRecord(first[COMMUNITY_DRAFT_METADATA_KEY])) return null
  const raw = first[COMMUNITY_DRAFT_METADATA_KEY]
  if (!isRecord(raw) || raw.version !== 1 || !["draft", "published"].includes(String(raw.status))) {
    return null
  }
  const url = text(raw.url, MAX_PUBLICATION_DRAFT_URL)
  if (url === null || (url && safeHref(url) !== url)) return null
  const origin = normalizeOrigin(raw.origin as PublicationDraftOrigin | undefined)
  const remotePublicationId =
    Number.isSafeInteger(raw.remotePublicationId) && Number(raw.remotePublicationId) >= 0
      ? Number(raw.remotePublicationId)
      : undefined
  const publishedAt =
    typeof raw.publishedAt === "number" && Number.isFinite(raw.publishedAt)
      ? raw.publishedAt
      : undefined
  return {
    version: 1,
    status: raw.status as PublicationDraftStatus,
    url,
    ...(origin ? { origin } : {}),
    ...(remotePublicationId === undefined ? {} : { remotePublicationId }),
    ...(publishedAt === undefined ? {} : { publishedAt }),
  }
}

export function publicationDraftFromNode(
  value: unknown,
  ref: FileRef,
  version: string | null,
): PublicationDraft | null {
  if (!isRecord(value) || value.kind !== "note" || !Array.isArray(value.content)) return null
  if (
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    typeof value.createdAt !== "number" ||
    typeof value.updatedAt !== "number" ||
    !Array.isArray(value.tags) ||
    !value.tags.every((tag) => typeof tag === "string")
  ) {
    return null
  }
  const metadata = decodeDraftMetadata(value.content)
  if (!metadata) return null
  try {
    const normalized = normalizePublicationDraftInput({
      title: value.title,
      url: metadata.url,
      body: bodyFromDraftContent(value.content),
    })
    return {
      id: value.id,
      ref,
      version,
      ...normalized,
      status: metadata.status,
      ...(metadata.origin ? { origin: metadata.origin } : {}),
      ...(metadata.remotePublicationId === undefined
        ? {}
        : { remotePublicationId: metadata.remotePublicationId }),
      ...(metadata.publishedAt === undefined ? {} : { publishedAt: metadata.publishedAt }),
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
      tags: value.tags,
    }
  } catch {
    return null
  }
}

function noteRef(id: string): FileRef {
  return resourceFileRef({ scheme: "node", kind: "note", id })
}

function receiptId(value: unknown): string {
  const id = isRecord(value) ? value.id : null
  if (typeof id !== "string" || !id) throw new Error("本地审计没有返回有效回执")
  return id
}

export function communityMutationGuardTargets(value: unknown): CommunityMutationGuards {
  if (!isRecord(value) || !Array.isArray(value.records)) {
    return { pendingDraftIds: [], publishedDraftIds: [], pendingPublicationIds: [] }
  }
  const pendingDraftIds = new Set<string>()
  const publishedDraftIds = new Set<string>()
  const pendingPublicationIds = new Set<number>()
  for (const record of value.records) {
    if (!isRecord(record) || !isRecord(record.target)) continue
    const id = record.target.id
    if (
      record.operation === "community.publish" &&
      record.target.kind === "publication-draft" &&
      typeof id === "string" &&
      id
    ) {
      if (record.status === "pending") pendingDraftIds.add(id)
      if (record.status === "committed") publishedDraftIds.add(id)
      continue
    }
    if (
      record.operation === "community.publication.delete" &&
      record.status === "pending" &&
      record.target.kind === "publication" &&
      typeof id === "string"
    ) {
      const publicationId = Number(id)
      if (
        Number.isSafeInteger(publicationId) &&
        publicationId >= 0 &&
        String(publicationId) === id
      ) {
        pendingPublicationIds.add(publicationId)
      }
    }
  }
  return {
    pendingDraftIds: [...pendingDraftIds],
    publishedDraftIds: [...publishedDraftIds],
    pendingPublicationIds: [...pendingPublicationIds],
  }
}

export async function listCommunityMutationGuards(): Promise<CommunityMutationGuards> {
  const result = await readFile(AGENT_AUDIT_FILE_REF, READ_CONTEXT, { encoding: "json" })
  return communityMutationGuardTargets(result.data)
}

const DEFAULT_STORAGE_DEPS: PublicationDraftStorageDeps = {
  listNotes: listNoteFiles,
  async listBookmarks() {
    const { bookmarks } = await listBookmarkFiles()
    return { bookmarks }
  },
  readNote(ref) {
    return readFile(ref, READ_CONTEXT, { encoding: "json" })
  },
  createNote(input) {
    return createNoteFile(null, input)
  },
  editNote(ref, input, expectedVersion) {
    return invokeFileAction(ref, "edit", input, ACTION_CONTEXT, { expectedVersion })
  },
  deleteNote(ref, expectedVersion) {
    return invokeFileAction(ref, "delete", undefined, ACTION_CONTEXT, { expectedVersion })
  },
  now: Date.now,
}

async function readDraft(
  ref: FileRef,
  fallbackVersion: string | null,
  deps: PublicationDraftStorageDeps,
): Promise<PublicationDraft> {
  const result = await deps.readNote(ref)
  const draft = publicationDraftFromNode(result.data, ref, result.version ?? fallbackVersion)
  if (!draft) throw new Error("本地发布草稿格式无效")
  return draft
}

export async function listPublicationDrafts(
  deps: PublicationDraftStorageDeps = DEFAULT_STORAGE_DEPS,
): Promise<PublicationDraft[]> {
  const notes = (await deps.listNotes(false)).filter((note) =>
    note.tags.includes(COMMUNITY_DRAFT_TAG),
  )
  const drafts = await mapConcurrentOrdered(
    notes,
    PUBLICATION_DRAFT_READ_CONCURRENCY,
    async (note) => {
      try {
        return await readDraft(noteRef(note.id), note.version, deps)
      } catch {
        return null
      }
    },
  )
  return drafts
    .filter((draft): draft is PublicationDraft => draft?.status === "draft")
    .sort((left, right) => right.updatedAt - left.updatedAt || right.id.localeCompare(left.id))
}

function sourceBodyFromNote(note: FileNote, content: NoteContent): { body: string; url: string } {
  const blocks = content.map(blockText)
  const plain = noteText(content)
  const sourceUrl = webSnapshotSourceFromText(plain) ?? ""
  if (note.tags.includes(WEB_EXCERPT_TAG)) {
    return { body: webExcerptTextFromText(plain) ?? blocks.join("\n\n").trim(), url: sourceUrl }
  }
  if (note.tags.includes(WEB_SNAPSHOT_TAG)) {
    const body = blocks
      .filter(
        (block) =>
          !block.startsWith(WEB_SNAPSHOT_SOURCE_PREFIX) &&
          !block.startsWith(WEB_SNAPSHOT_CAPTURED_AT_PREFIX),
      )
      .join("\n\n")
      .trim()
    return { body, url: sourceUrl }
  }
  return { body: blocks.join("\n\n").trim(), url: sourceUrl }
}

function boundedSourceBody(body: string): { body: string; truncated: boolean } {
  const normalized = body.replace(/\r\n?/gu, "\n").trim()
  if (normalized.length <= MAX_PUBLICATION_DRAFT_BODY) {
    return { body: normalized, truncated: false }
  }
  return {
    body: `${normalized.slice(0, MAX_PUBLICATION_DRAFT_BODY - 1).trimEnd()}…`,
    truncated: true,
  }
}

async function noteSource(
  note: FileNote,
  deps: PublicationDraftStorageDeps,
): Promise<PublicationDraftSource | null> {
  try {
    const result = await deps.readNote(noteRef(note.id))
    const node = result.data as Partial<NodeOfKind<"note">> | null
    if (node?.kind !== "note" || !Array.isArray(node.content)) return null
    const originKind =
      note.tags.includes(WEB_SNAPSHOT_TAG) || note.tags.includes(WEB_EXCERPT_TAG)
        ? "browser-capture"
        : "note"
    const extracted = sourceBodyFromNote(note, node.content)
    const bounded = boundedSourceBody(extracted.body)
    const title = note.title.trim() || "无标题笔记"
    return {
      key: `${originKind}:${note.id}`,
      kind: originKind,
      id: note.id,
      title: title.slice(0, MAX_PUBLICATION_DRAFT_TITLE),
      url: extracted.url,
      body: bounded.body,
      version: result.version ?? note.version,
      updatedAt: note.updatedAt,
      description: originKind === "browser-capture" ? "浏览捕获" : "本地笔记",
      truncated: bounded.truncated,
    }
  } catch {
    return null
  }
}

function bookmarkSource(bookmark: FileBookmark): PublicationDraftSource {
  const bounded = boundedSourceBody(bookmark.description)
  return {
    key: `bookmark:${bookmark.id}`,
    kind: "bookmark",
    id: bookmark.id,
    title: (bookmark.title.trim() || bookmark.url).slice(0, MAX_PUBLICATION_DRAFT_TITLE),
    url: safeHref(bookmark.url) ?? "",
    body: bounded.body,
    version: bookmark.version,
    updatedAt: bookmark.createdAt,
    description: "本地书签",
    truncated: bounded.truncated,
  }
}

export async function listPublicationDraftSources(
  deps: PublicationDraftStorageDeps = DEFAULT_STORAGE_DEPS,
): Promise<PublicationDraftSource[]> {
  const [notes, bookmarkResult] = await Promise.all([deps.listNotes(false), deps.listBookmarks()])
  const eligibleNotes = notes
    .filter(
      (note) =>
        !note.tags.includes(COMMUNITY_DRAFT_TAG) && !note.tags.includes(COMMUNITY_PUBLISHED_TAG),
    )
    .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
    .slice(0, MAX_PUBLICATION_DRAFT_SOURCES)
  const noteSources = await mapConcurrentOrdered(
    eligibleNotes,
    PUBLICATION_DRAFT_READ_CONCURRENCY,
    (note) => noteSource(note, deps),
  )
  return [
    ...noteSources.filter((source): source is PublicationDraftSource => source !== null),
    ...bookmarkResult.bookmarks.map(bookmarkSource),
  ]
    .sort(
      (left, right) => right.updatedAt - left.updatedAt || left.title.localeCompare(right.title),
    )
    .slice(0, MAX_PUBLICATION_DRAFT_SOURCES)
}

function originFromSource(source: PublicationDraftSource): PublicationDraftOrigin {
  return {
    kind: source.kind,
    id: source.id,
    title: source.title,
    version: source.version,
  }
}

export async function createPublicationDraft(
  input: PublicationDraftInput,
  origin?: PublicationDraftOrigin,
  deps: PublicationDraftStorageDeps = DEFAULT_STORAGE_DEPS,
): Promise<PublicationDraft> {
  const normalized = normalizePublicationDraftInput(input)
  const file = await deps.createNote({
    title: normalized.title,
    content: publicationDraftContent(normalized, { origin }),
    tags: [COMMUNITY_DRAFT_TAG],
  })
  const resource = resourceRefForFile(file.ref)
  if (resource?.scheme !== "node" || resource.kind !== "note") {
    throw new Error("文件系统没有返回有效的草稿笔记")
  }
  return readDraft(file.ref, file.version ?? null, deps)
}

export function createPublicationDraftFromSource(
  source: PublicationDraftSource,
  deps: PublicationDraftStorageDeps = DEFAULT_STORAGE_DEPS,
): Promise<PublicationDraft> {
  return createPublicationDraft(
    { title: source.title, url: source.url, body: source.body },
    originFromSource(source),
    deps,
  )
}

export async function updatePublicationDraft(
  draft: PublicationDraft,
  input: PublicationDraftInput,
  deps: PublicationDraftStorageDeps = DEFAULT_STORAGE_DEPS,
): Promise<PublicationDraft> {
  const normalized = normalizePublicationDraftInput(input)
  await deps.editNote(
    draft.ref,
    {
      title: normalized.title,
      content: publicationDraftContent(normalized, { origin: draft.origin }),
      tags: [
        ...new Set([
          ...draft.tags.filter((tag) => tag !== COMMUNITY_PUBLISHED_TAG),
          COMMUNITY_DRAFT_TAG,
        ]),
      ],
    },
    draft.version,
  )
  return readDraft(draft.ref, null, deps)
}

export async function discardPublicationDraft(
  draft: PublicationDraft,
  deps: PublicationDraftStorageDeps = DEFAULT_STORAGE_DEPS,
): Promise<void> {
  await deps.deleteNote(draft.ref, draft.version)
}

export async function archivePublishedDraft(
  draft: PublicationDraft,
  publication: Publication | null,
  deps: PublicationDraftStorageDeps = DEFAULT_STORAGE_DEPS,
): Promise<PublicationDraft> {
  const publishedAt = publication?.created_at ?? deps.now()
  await deps.editNote(
    draft.ref,
    {
      title: draft.title,
      content: publicationDraftContent(draft, {
        origin: draft.origin,
        status: "published",
        ...(publication ? { remotePublicationId: publication.id } : {}),
        publishedAt,
      }),
      tags: [
        ...new Set([
          ...draft.tags.filter(
            (tag) => tag !== COMMUNITY_DRAFT_TAG && tag !== COMMUNITY_PUBLISHED_TAG,
          ),
          COMMUNITY_PUBLISHED_TAG,
        ]),
      ],
    },
    draft.version,
  )
  return readDraft(draft.ref, null, deps)
}

async function beginAuditViaFileSystem(input: PublicationAuditInput): Promise<string> {
  return receiptId(
    await invokeFileAction(AGENT_AUDIT_FILE_REF, AGENT_AUDIT_APPEND_ACTION, input, ACTION_CONTEXT),
  )
}

async function completeAuditViaFileSystem(input: {
  id: string
  status: "committed" | "failed"
  summary: string
}): Promise<void> {
  await invokeFileAction(AGENT_AUDIT_FILE_REF, AGENT_AUDIT_COMPLETE_ACTION, input, ACTION_CONTEXT)
}

const DEFAULT_WORKFLOW_DEPS: PublicationWorkflowDeps = {
  publishRemote: publish,
  deleteRemote: deletePublication,
  beginAudit: beginAuditViaFileSystem,
  completeAudit: completeAuditViaFileSystem,
  archiveDraft: archivePublishedDraft,
}

function remoteMutationResultUnknown(result: { ok: false; status?: number }): boolean {
  return (
    result.status === undefined ||
    result.status === 408 ||
    result.status === 425 ||
    result.status >= 500 ||
    (result.status >= 200 && result.status < 300)
  )
}

export async function publishCommunityDraft(
  token: string,
  draft: PublicationDraft,
  deps: PublicationWorkflowDeps = DEFAULT_WORKFLOW_DEPS,
): Promise<PublicationPublishOutcome> {
  const input = normalizePublicationDraftInput(draft)
  const auditId = await deps.beginAudit({
    source: "tool",
    operation: "community.publish",
    title: "公开发布社区内容",
    summary: "已确认公开发布，等待服务器回执",
    status: "pending",
    effect: "external",
    risk: "high",
    target: { kind: "publication-draft", id: draft.id, label: draft.title },
  })

  let result: Awaited<ReturnType<typeof publish>>
  try {
    result = await deps.publishRemote(token, {
      title: input.title,
      ...(input.url ? { url: input.url } : {}),
      ...(input.body ? { body: input.body } : {}),
    })
  } catch {
    return {
      status: "unknown",
      message: "服务器结果未知；为避免重复公开发布，本次不会自动重试",
    }
  }

  if (!result.ok) {
    if (remoteMutationResultUnknown(result)) {
      return {
        status: "unknown",
        message: "服务器结果未知；为避免重复公开发布，本次不会自动重试",
      }
    }
    try {
      await deps.completeAudit({ id: auditId, status: "failed", summary: "服务器明确拒绝发布" })
    } catch {
      return {
        status: "unknown",
        message: "服务器已拒绝发布，但本地审计仍待确认；修复审计前请勿重试",
      }
    }
    return { status: "failed", message: result.message }
  }

  let auditPending = false
  try {
    await deps.completeAudit({ id: auditId, status: "committed", summary: "服务器已确认公开发布" })
  } catch {
    auditPending = true
  }

  let archivePending = false
  try {
    await deps.archiveDraft(draft, result.data)
  } catch {
    archivePending = true
  }
  return { status: "published", publication: result.data, auditPending, archivePending }
}

export async function removeCommunityPublication(
  token: string,
  publication: Publication,
  deps: PublicationWorkflowDeps = DEFAULT_WORKFLOW_DEPS,
): Promise<PublicationDeleteOutcome> {
  const auditId = await deps.beginAudit({
    source: "tool",
    operation: "community.publication.delete",
    title: "删除公开社区内容",
    summary: "已确认删除公开内容，等待服务器回执",
    status: "pending",
    effect: "external",
    risk: "high",
    target: { kind: "publication", id: String(publication.id), label: publication.title },
  })
  let result: Awaited<ReturnType<typeof deletePublication>>
  try {
    result = await deps.deleteRemote(token, publication.id)
  } catch {
    return {
      status: "unknown",
      message: "服务器结果未知；为避免重复删除，本次不会自动重试",
    }
  }
  if (!result.ok) {
    if (remoteMutationResultUnknown(result)) {
      return {
        status: "unknown",
        message: "服务器结果未知；为避免重复删除，本次不会自动重试",
      }
    }
    try {
      await deps.completeAudit({ id: auditId, status: "failed", summary: "服务器明确拒绝删除" })
    } catch {
      return {
        status: "unknown",
        message: "服务器已拒绝删除，但本地审计仍待确认；修复审计前请勿重试",
      }
    }
    return { status: "failed", message: result.message }
  }
  let auditPending = false
  try {
    await deps.completeAudit({
      id: auditId,
      status: "committed",
      summary: "服务器已确认删除公开内容",
    })
  } catch {
    auditPending = true
  }
  return { status: "deleted", auditPending }
}
