// 笔记本地存储仓库 —— 基于 IndexedDB, 管理笔记本 (分组) + 笔记 (类 Notion 块文档)。
// 照 bookmarks-store / files-store 的本地优先模式: 列表只回元数据 + 摘要, 完整正文按需单取。
import { Note, NoteMeta, NoteContent, Notebook, NewNote } from "../model"
import { genId } from "@/components/lib/id"
import {
  idbBulkPut,
  idbDelete,
  idbGet,
  idbGetAll,
  idbPut,
  STORE_NOTES,
  STORE_NOTEBOOKS,
} from "@/components/lib/idb"
import { notifyHubUpdated } from "./flowback"

/** 空文档: 单个空段落 (Plate 段落块 type "p")。 */
export function emptyNoteContent(): NoteContent {
  return [{ type: "p", children: [{ text: "" }] }]
}

/**
 * 递归收集块文档里的纯文本 —— 用于搜索与列表摘要。
 * 零依赖, 不引 platejs: 任何带字符串 `text` 的节点取其文本, 带 `children` 数组的递归下钻。
 */
export function noteText(content: NoteContent): string {
  const parts: string[] = []
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return
    const n = node as { text?: unknown; children?: unknown }
    if (typeof n.text === "string") parts.push(n.text)
    if (Array.isArray(n.children)) {
      for (const child of n.children) walk(child)
    }
  }
  for (const block of content) walk(block)
  // 块间以空格分隔, 折叠多余空白, 便于摘要与大小写无关搜索
  return parts.join(" ").replace(/\s+/g, " ").trim()
}

/** 剥离完整 content, 回列表元数据 (含纯文本摘要 + 全文), 避免列表整块载入正文。 */
function toMeta(note: Note): NoteMeta {
  const text = noteText(note.content)
  return {
    id: note.id,
    title: note.title,
    notebookId: note.notebookId,
    tags: note.tags,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    // excerpt 截断仅供展示; search 保留全文, 让搜索覆盖正文深处 (兑现「搜索正文」承诺)
    excerpt: text.slice(0, 160),
    search: text,
  }
}

// ---- 笔记本 ----

export async function listNotebooks(): Promise<Notebook[]> {
  const notebooks = await idbGetAll<Notebook>(STORE_NOTEBOOKS)
  return notebooks.sort((a, b) => a.createdAt - b.createdAt)
}

export async function addNotebook(name: string): Promise<Notebook> {
  const notebook: Notebook = {
    id: genId("nb"),
    name: name.trim() || "未命名笔记本",
    createdAt: Date.now(),
  }
  await idbPut(STORE_NOTEBOOKS, notebook)
  return notebook
}

export async function renameNotebook(id: string, name: string): Promise<void> {
  const notebooks = await listNotebooks()
  const notebook = notebooks.find((n) => n.id === id)
  if (!notebook) return
  await idbPut(STORE_NOTEBOOKS, { ...notebook, name: name.trim() || notebook.name })
}

/** 删除笔记本; 其下笔记移到未分组 (notebookId = null), 不删除笔记 */
export async function deleteNotebook(id: string): Promise<void> {
  const notes = await idbGetAll<Note>(STORE_NOTES)
  const orphans = notes
    .filter((n) => n.notebookId === id)
    .map((n) => ({ ...n, notebookId: null }))
  if (orphans.length) await idbBulkPut(STORE_NOTES, orphans)
  await idbDelete(STORE_NOTEBOOKS, id)
  notifyHubUpdated()
}

// ---- 笔记 ----

/** 列出所有笔记元数据 (不含完整 content), 按最后编辑时间倒序 */
export async function listNotes(): Promise<NoteMeta[]> {
  const notes = await idbGetAll<Note>(STORE_NOTES)
  return notes.map(toMeta).sort((a, b) => b.updatedAt - a.updatedAt)
}

/** 读取单条完整笔记 (含 content) */
export async function getNote(id: string): Promise<Note | undefined> {
  const note = await idbGet<Note>(STORE_NOTES, id)
  // 兜底: 空/非数组正文 (如外部写入的损坏数据) 归一为合法空文档,
  // 避免编辑器把 [] 规范化成默认段落后被误判为「已编辑」而无故刷新 updatedAt。
  if (note && (!Array.isArray(note.content) || note.content.length === 0)) {
    return { ...note, content: emptyNoteContent() }
  }
  return note
}

export async function addNote(input: NewNote = {}): Promise<Note> {
  const now = Date.now()
  const note: Note = {
    id: genId("note"),
    title: input.title?.trim() ?? "",
    content: input.content ?? emptyNoteContent(),
    notebookId: input.notebookId ?? null,
    tags: input.tags ?? [],
    createdAt: now,
    updatedAt: now,
  }
  await idbPut(STORE_NOTES, note)
  notifyHubUpdated()
  return note
}

/** 更新笔记 (标题 / 正文 / 笔记本 / 标签); 自动刷新 updatedAt。 */
export async function updateNote(
  id: string,
  patch: Partial<Pick<Note, "title" | "content" | "notebookId" | "tags">>,
): Promise<Note | undefined> {
  const existing = await getNote(id)
  if (!existing) return undefined
  const next: Note = { ...existing, ...patch, updatedAt: Date.now() }
  await idbPut(STORE_NOTES, next)
  notifyHubUpdated()
  return next
}

export async function deleteNote(id: string): Promise<void> {
  await idbDelete(STORE_NOTES, id)
  notifyHubUpdated()
}
