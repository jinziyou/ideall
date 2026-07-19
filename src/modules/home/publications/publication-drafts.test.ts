import assert from "node:assert/strict"
import test from "node:test"
import type { FileRef, IdeallFile } from "@protocol/file-system"
import type { NoteContent } from "@protocol/files"
import type { NodeOfKind } from "@protocol/node"
import type { Publication } from "@protocol/peer"
import { buildWebSnapshotDocument, WEB_SNAPSHOT_TAG } from "@/files/web-snapshot"
import { noteText } from "@/files/note-text"
import { resourceFileRef } from "@/filesystem/resource-file-system"
import type { FileBookmark } from "@/modules/home/bookmarks/bookmark-file-system"
import type { FileNote } from "@/modules/home/notes/note-file-system"
import {
  archivePublishedDraft,
  communityMutationGuardTargets,
  COMMUNITY_DRAFT_METADATA_KEY,
  COMMUNITY_DRAFT_TAG,
  COMMUNITY_PUBLISHED_TAG,
  createPublicationDraft,
  createPublicationDraftFromSource,
  discardPublicationDraft,
  listPublicationDrafts,
  listPublicationDraftSources,
  MAX_PUBLICATION_DRAFT_BODY,
  normalizePublicationDraftInput,
  publicationDraftContent,
  publicationDraftFromNode,
  publishCommunityDraft,
  removeCommunityPublication,
  updatePublicationDraft,
  type PublicationDraft,
  type PublicationDraftSource,
} from "./publication-drafts"

function paragraph(text: string): Record<string, unknown> {
  return { type: "p", children: [{ text }] }
}

function draftFixture(overrides: Partial<PublicationDraft> = {}): PublicationDraft {
  return {
    id: "draft-1",
    ref: resourceFileRef({ scheme: "node", kind: "note", id: "draft-1" }),
    version: "10",
    status: "draft",
    title: "准备发布",
    url: "https://example.com/article",
    body: "只发送这段正文",
    origin: { kind: "note", id: "private-note", title: "私人来源", version: "7" },
    createdAt: 1,
    updatedAt: 10,
    tags: [COMMUNITY_DRAFT_TAG],
    ...overrides,
  }
}

test("publication drafts: codec keeps structured origin private and validates public fields", () => {
  const content = publicationDraftContent(
    { title: "  标题  ", url: "https://example.com/a", body: "第一段\n\n第二段" },
    { origin: { kind: "note", id: "note-private", title: "来源", version: "4" } },
  )
  assert.equal(noteText(content), "第一段 第二段")
  assert.equal(JSON.stringify(content).includes("note-private"), true)
  assert.equal(
    (content[0] as Record<string, unknown>)[COMMUNITY_DRAFT_METADATA_KEY] !== undefined,
    true,
  )

  const ref = resourceFileRef({ scheme: "node", kind: "note", id: "draft" })
  const decoded = publicationDraftFromNode(
    {
      id: "draft",
      kind: "note",
      title: "标题",
      content,
      tags: [COMMUNITY_DRAFT_TAG],
      createdAt: 1,
      updatedAt: 2,
    },
    ref,
    "2",
  )
  assert.equal(decoded?.url, "https://example.com/a")
  assert.equal(decoded?.body, "第一段\n\n第二段")
  assert.deepEqual(decoded?.origin, {
    kind: "note",
    id: "note-private",
    title: "来源",
    version: "4",
  })

  assert.throws(
    () => normalizePublicationDraftInput({ title: "标题", url: "javascript:alert(1)", body: "" }),
    /HTTP\(S\)/,
  )
  assert.throws(
    () =>
      normalizePublicationDraftInput({
        title: "标题",
        url: "",
        body: "x".repeat(MAX_PUBLICATION_DRAFT_BODY + 1),
      }),
    /最多允许/,
  )
})

test("publication drafts: audit targets restore unknown and local-archive guards", () => {
  assert.deepEqual(
    communityMutationGuardTargets({
      records: [
        {
          operation: "community.publish",
          status: "pending",
          target: { kind: "publication-draft", id: "draft-1", label: "草稿" },
        },
        {
          operation: "community.publication.delete",
          status: "pending",
          target: { kind: "publication", id: `pub:${"4".repeat(32)}`, label: "公开内容" },
        },
        {
          operation: "community.publish",
          status: "committed",
          target: { kind: "publication-draft", id: "finished", label: "已完成" },
        },
        {
          operation: "unrelated.tool",
          status: "pending",
          target: { kind: "publication", id: "7", label: "无关" },
        },
        {
          operation: "community.publication.delete",
          status: "pending",
          target: { kind: "publication", id: "42", label: "V1 数字 id" },
        },
      ],
    }),
    {
      pendingDraftIds: ["draft-1"],
      publishedDraftIds: ["finished"],
      pendingPublicationIds: [`pub:${"4".repeat(32)}`],
    },
  )
  assert.deepEqual(communityMutationGuardTargets(null), {
    pendingDraftIds: [],
    publishedDraftIds: [],
    pendingPublicationIds: [],
  })
})

test("publication drafts: source projection separates notes, bookmarks and browser captures", async () => {
  const snapshot = buildWebSnapshotDocument({
    url: "https://capture.example/story",
    text: "捕获正文",
    capturedAt: 1_700_000_000_000,
  })
  const notes: FileNote[] = [
    {
      id: "note-1",
      title: "普通笔记",
      parentId: null,
      sortKey: "a",
      tags: [],
      createdAt: 10,
      updatedAt: 30,
      excerpt: "",
      search: "",
      hasChildren: false,
      version: "30",
    },
    {
      id: "capture-1",
      title: "网页快照",
      parentId: null,
      sortKey: "b",
      tags: [WEB_SNAPSHOT_TAG],
      createdAt: 20,
      updatedAt: 40,
      excerpt: "",
      search: "",
      hasChildren: false,
      version: "40",
    },
    {
      id: "draft-hidden",
      title: "已有草稿",
      parentId: null,
      sortKey: "c",
      tags: [COMMUNITY_DRAFT_TAG],
      createdAt: 30,
      updatedAt: 50,
      excerpt: "",
      search: "",
      hasChildren: false,
      version: "50",
    },
  ]
  const contents = new Map<string, NoteContent>([
    ["note-1", [paragraph("正文一"), paragraph("正文二")]],
    ["capture-1", snapshot.content],
    ["draft-hidden", publicationDraftContent({ title: "草稿", url: "", body: "不应成为来源" })],
  ])
  const bookmark: FileBookmark = {
    id: "bookmark-1",
    title: "书签来源",
    url: "https://bookmark.example/",
    description: "书签摘要",
    favicon: "",
    folderId: null,
    tags: [],
    createdAt: 35,
    ref: resourceFileRef({ scheme: "node", kind: "bookmark", id: "bookmark-1" }),
    version: "35",
  }
  const sources = await listPublicationDraftSources({
    async listNotes() {
      return notes
    },
    async listBookmarks() {
      return { bookmarks: [bookmark] }
    },
    async readNote(ref) {
      const id = decodeURIComponent(ref.fileId).split(":").at(-1)!
      const note = notes.find((candidate) => candidate.id === id)!
      return {
        data: {
          id,
          kind: "note",
          title: note.title,
          content: contents.get(id),
          tags: note.tags,
          createdAt: note.createdAt,
          updatedAt: note.updatedAt,
        },
        version: note.version ?? undefined,
      }
    },
    async createNote() {
      throw new Error("not used")
    },
    async editNote() {
      throw new Error("not used")
    },
    async deleteNote() {
      throw new Error("not used")
    },
    now: () => 100,
  })

  assert.deepEqual(
    sources.map((source) => [source.kind, source.title]),
    [
      ["browser-capture", "网页快照"],
      ["bookmark", "书签来源"],
      ["note", "普通笔记"],
    ],
  )
  const capture = sources[0]!
  assert.equal(capture.url, "https://capture.example/story")
  assert.equal(capture.body, "捕获正文")
  assert.equal(capture.body.includes("捕获时间"), false)
  assert.equal(capture.body.includes("原始来源"), false)
})

function memoryStorage() {
  const nodes = new Map<string, NodeOfKind<"note">>()
  let clock = 100

  function refId(ref: FileRef): string {
    const decoded = decodeURIComponent(ref.fileId)
    return decoded.slice(decoded.lastIndexOf(":") + 1)
  }

  const deps = {
    async listNotes(): Promise<FileNote[]> {
      return [...nodes.values()]
        .filter((node) => node.deletedAt == null)
        .map((node) => ({
          id: node.id,
          title: node.title,
          parentId: node.parentId,
          sortKey: node.sortKey,
          tags: node.tags,
          createdAt: node.createdAt,
          updatedAt: node.updatedAt,
          excerpt: "",
          search: "",
          hasChildren: false,
          version: String(node.updatedAt),
        }))
    },
    async listBookmarks() {
      return { bookmarks: [] }
    },
    async readNote(ref: FileRef) {
      const node = nodes.get(refId(ref))
      if (!node || node.deletedAt != null) throw new Error("not found")
      return { data: structuredClone(node), version: String(node.updatedAt) }
    },
    async createNote(input: { title: string; content: NoteContent; tags: string[] }) {
      clock += 1
      const id = `draft-${clock}`
      const ref = resourceFileRef({ scheme: "node", kind: "note", id })
      nodes.set(id, {
        id,
        kind: "note",
        title: input.title,
        content: structuredClone(input.content),
        tags: [...input.tags],
        parentId: null,
        sortKey: "a",
        createdAt: clock,
        updatedAt: clock,
      })
      return {
        ref,
        kind: "file",
        name: input.title,
        mediaType: "application/vnd.ideall.note+json",
        capabilities: ["read", "write"],
        source: { kind: "system", id: "test", label: "test" },
        version: String(clock),
      } as IdeallFile
    },
    async editNote(
      ref: FileRef,
      input: { title: string; content: NoteContent; tags: string[] },
      expectedVersion: string | null,
    ) {
      const id = refId(ref)
      const current = nodes.get(id)
      if (!current || String(current.updatedAt) !== expectedVersion) throw new Error("conflict")
      clock += 1
      nodes.set(id, {
        ...current,
        title: input.title,
        content: structuredClone(input.content),
        tags: [...input.tags],
        updatedAt: clock,
      })
    },
    async deleteNote(ref: FileRef, expectedVersion: string | null) {
      const id = refId(ref)
      const current = nodes.get(id)
      if (!current || String(current.updatedAt) !== expectedVersion) throw new Error("conflict")
      clock += 1
      nodes.set(id, { ...current, updatedAt: clock, deletedAt: clock })
    },
    now: () => ++clock,
  }
  return { deps, nodes }
}

test("publication drafts: CRUD uses Note CAS, archives successes and discards through soft delete", async () => {
  const storage = memoryStorage()
  const source: PublicationDraftSource = {
    key: "note:source",
    kind: "note",
    id: "source",
    title: "来源标题",
    url: "https://example.com/source",
    body: "来源正文",
    version: "9",
    updatedAt: 9,
    description: "本地笔记",
    truncated: false,
  }
  const created = await createPublicationDraftFromSource(source, storage.deps)
  assert.equal(created.origin?.id, "source")
  assert.deepEqual(
    (await listPublicationDrafts(storage.deps)).map((draft) => draft.id),
    [created.id],
  )

  const updated = await updatePublicationDraft(
    created,
    { title: "改后标题", url: "", body: "改后正文" },
    storage.deps,
  )
  assert.equal(updated.title, "改后标题")
  await assert.rejects(
    updatePublicationDraft(created, { title: "过期写入", url: "", body: "" }, storage.deps),
    /conflict/,
  )

  const publication: Publication = {
    id: `pub:${"8".repeat(32)}`,
    title: updated.title,
    url: "",
    body: updated.body,
    created_at: 500,
  }
  const archived = await archivePublishedDraft(updated, publication, storage.deps)
  assert.equal(archived.status, "published")
  assert.equal(archived.remotePublicationId, `pub:${"8".repeat(32)}`)
  assert.equal(archived.tags.includes(COMMUNITY_PUBLISHED_TAG), true)
  assert.deepEqual(await listPublicationDrafts(storage.deps), [])

  const another = await createPublicationDraft(
    { title: "待丢弃", url: "", body: "" },
    undefined,
    storage.deps,
  )
  await discardPublicationDraft(another, storage.deps)
  assert.equal(storage.nodes.get(another.id)?.deletedAt != null, true)
})

function workflow(overrides: Record<string, unknown> = {}) {
  const events: string[] = []
  let sent: unknown
  const publication: Publication = {
    id: `pub:${"2".repeat(32)}`,
    title: "准备发布",
    url: "https://example.com/article",
    body: "只发送这段正文",
    created_at: 100,
  }
  const deps = {
    async publishRemote(_token: string, input: unknown) {
      events.push("publish")
      sent = input
      return { ok: true as const, data: publication }
    },
    async deleteRemote() {
      events.push("delete")
      return { ok: true as const, data: null }
    },
    async beginAudit(input: unknown) {
      events.push("audit:begin")
      assert.equal(JSON.stringify(input).includes("只发送这段正文"), false)
      assert.equal(JSON.stringify(input).includes("https://example.com/article"), false)
      assert.equal(JSON.stringify(input).includes("private-note"), false)
      return "audit-1"
    },
    async completeAudit(input: { status: string }) {
      events.push(`audit:${input.status}`)
    },
    async archiveDraft(draft: PublicationDraft) {
      events.push("archive")
      return { ...draft, status: "published" as const }
    },
    ...overrides,
  }
  return { deps, events, publication, sent: () => sent }
}

test("publication drafts: publish writes pending audit before remote and sends only public fields", async () => {
  const fixture = workflow()
  const outcome = await publishCommunityDraft("token", draftFixture(), fixture.deps)
  assert.equal(outcome.status, "published")
  assert.deepEqual(fixture.events, ["audit:begin", "publish", "audit:committed", "archive"])
  assert.deepEqual(fixture.sent(), {
    title: "准备发布",
    url: "https://example.com/article",
    body: "只发送这段正文",
  })
})

test("publication drafts: audit failure blocks publishing before the remote side effect", async () => {
  let called = false
  const fixture = workflow({
    async beginAudit() {
      throw new Error("audit unavailable")
    },
    async publishRemote() {
      called = true
      return { ok: true as const, data: null }
    },
  })
  await assert.rejects(
    publishCommunityDraft("token", draftFixture(), fixture.deps),
    /audit unavailable/,
  )
  assert.equal(called, false)
})

test("publication drafts: transport and ambiguous server failures remain pending and are not retried", async () => {
  const thrown = workflow({
    async publishRemote() {
      thrown.events.push("publish")
      throw new Error("private transport detail")
    },
  })
  const thrownOutcome = await publishCommunityDraft("token", draftFixture(), thrown.deps)
  assert.equal(thrownOutcome.status, "unknown")
  assert.deepEqual(thrown.events, ["audit:begin", "publish"])
  assert.equal(JSON.stringify(thrownOutcome).includes("private transport detail"), false)

  const server = workflow({
    async publishRemote() {
      server.events.push("publish")
      return { ok: false as const, status: 503, message: "private upstream error" }
    },
  })
  const serverOutcome = await publishCommunityDraft("token", draftFixture(), server.deps)
  assert.equal(serverOutcome.status, "unknown")
  assert.deepEqual(server.events, ["audit:begin", "publish"])
  assert.equal(JSON.stringify(serverOutcome).includes("private upstream error"), false)
})

test("publication drafts: explicit rejection settles failed and remote deletion is also audited", async () => {
  const rejected = workflow({
    async publishRemote() {
      rejected.events.push("publish")
      return { ok: false as const, status: 422, message: "标题不符合要求" }
    },
  })
  const rejectedOutcome = await publishCommunityDraft("token", draftFixture(), rejected.deps)
  assert.deepEqual(rejectedOutcome, { status: "failed", message: "标题不符合要求" })
  assert.deepEqual(rejected.events, ["audit:begin", "publish", "audit:failed"])

  const unsettled = workflow({
    async publishRemote() {
      unsettled.events.push("publish")
      return { ok: false as const, status: 422, message: "标题不符合要求" }
    },
    async completeAudit() {
      throw new Error("audit settlement unavailable")
    },
  })
  const unsettledOutcome = await publishCommunityDraft("token", draftFixture(), unsettled.deps)
  assert.equal(unsettledOutcome.status, "unknown")
  assert.equal(JSON.stringify(unsettledOutcome).includes("标题不符合要求"), false)

  const deleted = workflow()
  const outcome = await removeCommunityPublication("token", deleted.publication, deleted.deps)
  assert.deepEqual(outcome, { status: "deleted", auditPending: false })
  assert.deepEqual(deleted.events, ["audit:begin", "delete", "audit:committed"])
})
