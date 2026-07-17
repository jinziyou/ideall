import type { FilesPort, NoteContent } from "@protocol/files"
import type { NodeOfKind } from "@protocol/node"
import { resourceFileRef } from "@/filesystem/resource-file-system"
import { invokeFileAction, readFile } from "@/filesystem/registry"
import { isAgentContextSource, type AgentContextSource } from "@/lib/agent-context-tray"
import { randomId } from "@/lib/id"
import { getFilesPort } from "@protocol/files"
import { createTaskThread, deleteTask } from "../agent-task-write-adapter"
import type { AgentArtifactReceipt, AgentMessage, AgentThread } from "./model"

export const AGENT_NOTE_TITLE_LIMIT = 120
export const AGENT_NOTE_BODY_LIMIT = 64_000
export const AGENT_NOTE_TAG = "AI 生成"
export const AGENT_BOOKMARK_DESCRIPTION_LIMIT = 8_000
const AGENT_NOTE_SOURCE_LIMIT = 12_000
const AGENT_NOTE_BLOCK_LIMIT = 512
const AGENT_NOTE_BLOCK_TEXT_LIMIT = 2_000
const AGENT_NOTE_TRUNCATION_MESSAGE = "（内容包含过多段落，已按本地笔记块上限截断）"

export interface AgentNoteDraft {
  title: string
  body: string
}

export interface AgentTaskArtifactDraft extends AgentNoteDraft {
  workspaceId: string
  workspaceName: string
}

export interface AgentBookmarkTargetSnapshot {
  nodeId: string
  title: string
  url: string
  description: string
  version: string
}

export interface AgentBookmarkDescriptionDraft {
  target: AgentBookmarkTargetSnapshot
  description: string
}

type NoteWriter = Pick<FilesPort, "fsCreateNode">

type TaskArtifactGateway = Readonly<{
  create(workspaceId: string): Promise<AgentThread>
  commit(
    thread: AgentThread,
    title: string,
    messages: readonly AgentMessage[],
  ): Promise<{ committedVersion: number }>
  remove(id: string, expectedThreadUpdatedAt: number): Promise<void>
}>

type BookmarkArtifactGateway = Readonly<{
  load(id: string): Promise<AgentBookmarkTargetSnapshot>
  commit(id: string, description: string, expectedVersion: string): Promise<number>
}>

function paragraph(text: string): Readonly<{
  type: "p"
  children: readonly Readonly<{ text: string }>[]
}> {
  return { type: "p", children: [{ text }] }
}

function normalizeLineBreaks(value: string): string {
  return value.replace(/\r\n?/g, "\n")
}

function cleanTitle(value: string): string {
  return value
    .replace(/^\s{0,3}#{1,6}\s+/, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

export function agentNoteDraftForMessage(message: Pick<AgentMessage, "content">): AgentNoteDraft {
  const body = normalizeLineBreaks(message.content).trim().slice(0, AGENT_NOTE_BODY_LIMIT)
  const firstLine = body.split("\n").find((line) => cleanTitle(line)) ?? "AI 回答"
  const title = cleanTitle(firstLine).slice(0, AGENT_NOTE_TITLE_LIMIT) || "AI 回答"
  return { title, body }
}

function sourceLine(source: AgentContextSource): string {
  return source.type === "url"
    ? `${source.title} · ${source.url}`
    : `${source.title} · node:${source.kind}:${source.id}`
}

function bodyBlocks(body: string): NoteContent {
  const blocks: NoteContent = []
  let truncated = false
  for (const line of body.split("\n")) {
    const chunks = line.length
      ? Array.from({ length: Math.ceil(line.length / AGENT_NOTE_BLOCK_TEXT_LIMIT) }, (_, index) =>
          line.slice(
            index * AGENT_NOTE_BLOCK_TEXT_LIMIT,
            (index + 1) * AGENT_NOTE_BLOCK_TEXT_LIMIT,
          ),
        )
      : [""]
    for (const chunk of chunks) {
      if (blocks.length >= AGENT_NOTE_BLOCK_LIMIT) {
        truncated = true
        break
      }
      blocks.push(paragraph(chunk))
    }
    if (truncated) break
  }
  if (truncated) blocks[blocks.length - 1] = paragraph(AGENT_NOTE_TRUNCATION_MESSAGE)
  return blocks
}

/** 把预览中的纯文本和实际注入来源转换成普通笔记块；来源只落引用，不复制原资料正文。 */
export function agentNoteContent(
  draft: AgentNoteDraft,
  requestedSources: readonly AgentContextSource[],
): NoteContent {
  const body = normalizeLineBreaks(draft.body).trim().slice(0, AGENT_NOTE_BODY_LIMIT)
  if (!body) throw new Error("笔记正文不能为空")
  const sources = requestedSources.filter(isAgentContextSource)
  const content = bodyBlocks(body)
  if (sources.length > 0) {
    content.push(paragraph(""), paragraph("来源（AI 上下文引用）"))
    let remaining = AGENT_NOTE_SOURCE_LIMIT
    for (const source of sources) {
      if (remaining <= 0) break
      const line = sourceLine(source).slice(0, remaining)
      content.push(paragraph(line))
      remaining -= line.length
    }
  }
  return content
}

function normalizedDraft(draft: AgentNoteDraft): AgentNoteDraft {
  const title = cleanTitle(draft.title).slice(0, AGENT_NOTE_TITLE_LIMIT)
  const body = normalizeLineBreaks(draft.body).trim().slice(0, AGENT_NOTE_BODY_LIMIT)
  if (!title) throw new Error("笔记标题不能为空")
  if (!body) throw new Error("笔记正文不能为空")
  return { title, body }
}

function validSources(requestedSources: readonly AgentContextSource[]): AgentContextSource[] {
  return requestedSources.filter(isAgentContextSource)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function committedUpdatedAt(value: unknown, kind: "thread" | "bookmark", id: string): number {
  if (!isRecord(value) || !isRecord(value.meta) || !isRecord(value.meta.ref)) {
    throw new Error("文件系统未返回写入回执")
  }
  const ref = value.meta.ref
  const updatedAt = value.meta.updatedAt
  if (
    ref.scheme !== "node" ||
    ref.kind !== kind ||
    ref.id !== id ||
    typeof updatedAt !== "number" ||
    !Number.isSafeInteger(updatedAt) ||
    updatedAt < 0
  ) {
    throw new Error("文件系统返回了无效写入回执")
  }
  return updatedAt
}

const ACTION_CONTEXT = { actor: "ui", permissions: [], intent: "action" } as const
const CONTENT_CONTEXT = { actor: "ui", permissions: [], intent: "content" } as const

const taskArtifactGateway: TaskArtifactGateway = {
  create: createTaskThread,
  async commit(thread, title, messages) {
    const result = await invokeFileAction(
      resourceFileRef({ scheme: "node", kind: "thread", id: thread.id }),
      "edit",
      { title, content: { messages } },
      ACTION_CONTEXT,
      { expectedVersion: String(thread.updatedAt) },
    )
    return { committedVersion: committedUpdatedAt(result, "thread", thread.id) }
  },
  remove: deleteTask,
}

const bookmarkArtifactGateway: BookmarkArtifactGateway = {
  async load(id) {
    const result = await readFile(
      resourceFileRef({ scheme: "node", kind: "bookmark", id }),
      CONTENT_CONTEXT,
      { encoding: "json" },
    )
    if (
      !isRecord(result.data) ||
      result.data.kind !== "bookmark" ||
      !isRecord(result.data.content)
    ) {
      throw new Error("书签已不存在或内容无效")
    }
    const node = result.data
    const content = result.data.content
    if (
      node.id !== id ||
      typeof node.title !== "string" ||
      typeof content.url !== "string" ||
      (content.description !== undefined && typeof content.description !== "string") ||
      typeof result.version !== "string" ||
      !result.version
    ) {
      throw new Error("文件系统返回了无效书签")
    }
    const description = content.description ?? ""
    if (description.length > AGENT_BOOKMARK_DESCRIPTION_LIMIT) {
      throw new Error("现有书签描述过长，无法提供安全撤销")
    }
    return {
      nodeId: id,
      title: node.title.slice(0, 256),
      url: content.url,
      description,
      version: result.version,
    }
  },
  async commit(id, description, expectedVersion) {
    const result = await invokeFileAction(
      resourceFileRef({ scheme: "node", kind: "bookmark", id }),
      "edit",
      { content: { description } },
      ACTION_CONTEXT,
      { expectedVersion },
    )
    return committedUpdatedAt(result, "bookmark", id)
  },
}

/** 用户确认后的唯一提交点：创建本地笔记并返回 committed Node 派生的可持久回执。 */
export async function saveAgentResponseAsNote(
  draft: AgentNoteDraft,
  requestedSources: readonly AgentContextSource[],
  writer: NoteWriter = getFilesPort(),
): Promise<AgentArtifactReceipt> {
  const normalized = normalizedDraft(draft)
  const sources = validSources(requestedSources)
  const created = await writer.fsCreateNode({
    kind: "note",
    parentId: null,
    title: normalized.title,
    tags: [AGENT_NOTE_TAG],
    content: agentNoteContent(normalized, sources),
  })
  if (created.kind !== "note") throw new Error("文件系统未返回新建笔记")
  const note = created as NodeOfKind<"note">
  return {
    kind: "note",
    nodeId: note.id,
    title: note.title || normalized.title,
    createdAt: note.createdAt,
    sourceKeys: sources.map((source) => source.key),
  }
}

/** 读取本次回答实际引用过的书签，版本随预览返回并绑定后续提交。 */
export function loadAgentBookmarkTarget(
  source: AgentContextSource,
  gateway: BookmarkArtifactGateway = bookmarkArtifactGateway,
): Promise<AgentBookmarkTargetSnapshot> {
  if (!isAgentContextSource(source) || source.type !== "node" || source.kind !== "bookmark") {
    return Promise.reject(new Error("只能选择本次回答引用过的书签"))
  }
  return gateway.load(source.id)
}

/** 把回答复制为独立任务线程；空任务创建后的正文提交失败会按初始版本清理。 */
export async function saveAgentResponseAsTask(
  draft: AgentTaskArtifactDraft,
  requestedSources: readonly AgentContextSource[],
  gateway: TaskArtifactGateway = taskArtifactGateway,
): Promise<AgentArtifactReceipt> {
  const normalized = normalizedDraft(draft)
  const workspaceId = draft.workspaceId.trim()
  const workspaceName = draft.workspaceName.trim().slice(0, 256)
  if (!workspaceId || workspaceId.length > 256 || !workspaceName) throw new Error("任务工作区无效")
  const sources = validSources(requestedSources)
  const created = await gateway.create(workspaceId)
  const messageTime = Date.now()
  const taskMessages: AgentMessage[] = [
    {
      id: randomId(),
      role: "user",
      content: "将以下 AI 回答保存为任务资料，供后续继续处理。",
      createdAt: messageTime,
    },
    {
      id: randomId(),
      role: "assistant",
      content: normalized.body,
      createdAt: messageTime,
      ...(sources.length ? { sources } : {}),
    },
  ]
  let committedVersion: number
  try {
    ;({ committedVersion } = await gateway.commit(created, normalized.title, taskMessages))
    if (!Number.isSafeInteger(committedVersion) || committedVersion < 0) {
      throw new Error("任务写入回执版本无效")
    }
  } catch (error) {
    try {
      await gateway.remove(created.id, created.updatedAt)
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "任务正文提交失败，且空任务清理失败")
    }
    throw error
  }
  return {
    kind: "task",
    nodeId: created.id,
    title: normalized.title,
    createdAt: created.createdAt,
    sourceKeys: sources.map((source) => source.key),
    workspaceId,
    workspaceName,
    committedVersion,
  }
}

/** 只更新回答实际引用书签的 description；expectedVersion 来自用户看到的预览快照。 */
export async function saveAgentResponseToBookmarkDescription(
  draft: AgentBookmarkDescriptionDraft,
  requestedSources: readonly AgentContextSource[],
  gateway: BookmarkArtifactGateway = bookmarkArtifactGateway,
): Promise<AgentArtifactReceipt> {
  const sources = validSources(requestedSources)
  const allowed = sources.some(
    (source) =>
      source.type === "node" && source.kind === "bookmark" && source.id === draft.target.nodeId,
  )
  if (!allowed) throw new Error("只能更新本次回答实际引用过的书签")
  const description = normalizeLineBreaks(draft.description).trim()
  if (!description) throw new Error("书签描述不能为空")
  if (description.length > AGENT_BOOKMARK_DESCRIPTION_LIMIT) throw new Error("书签描述过长")
  if (draft.target.description.length > AGENT_BOOKMARK_DESCRIPTION_LIMIT) {
    throw new Error("现有书签描述过长，无法提供安全撤销")
  }
  const committedVersion = await gateway.commit(
    draft.target.nodeId,
    description,
    draft.target.version,
  )
  if (!Number.isSafeInteger(committedVersion) || committedVersion < 0) {
    throw new Error("书签写入回执版本无效")
  }
  return {
    kind: "bookmark-description",
    nodeId: draft.target.nodeId,
    title: draft.target.title,
    createdAt: committedVersion,
    sourceKeys: sources.map((source) => source.key),
    previousDescription: draft.target.description,
    committedVersion,
  }
}

/** 版本绑定撤销：目标被后续编辑后由 Storage CAS 拒绝，绝不覆盖新内容。 */
export async function undoAgentArtifact(
  receipt: Extract<AgentArtifactReceipt, { kind: "task" | "bookmark-description" }>,
  gateways: Readonly<{
    task: TaskArtifactGateway
    bookmark: BookmarkArtifactGateway
  }> = { task: taskArtifactGateway, bookmark: bookmarkArtifactGateway },
): Promise<AgentArtifactReceipt> {
  if (receipt.undoneAt !== undefined) return receipt
  if (receipt.kind === "task") {
    await gateways.task.remove(receipt.nodeId, receipt.committedVersion)
    return { ...receipt, undoneAt: Date.now() }
  }
  const restoredVersion = await gateways.bookmark.commit(
    receipt.nodeId,
    receipt.previousDescription,
    String(receipt.committedVersion),
  )
  return { ...receipt, undoneAt: restoredVersion }
}
