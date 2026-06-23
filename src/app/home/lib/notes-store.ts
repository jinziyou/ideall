// 笔记本地存储仓库 —— 基于 IndexedDB, 管理笔记本 (分组) + 笔记 (类 Notion 块文档)。
// 照 bookmarks-store / files-store 的本地优先模式: 列表只回元数据 + 摘要, 完整正文按需单取。
import { Note, NoteMeta, NoteContent, Notebook, NewNote } from "../model"
import { genId } from "@/components/lib/id"
import {
  idbBulkPut,
  idbCount,
  idbDelete,
  idbGet,
  idbGetAll,
  idbPut,
  idbReadModifyWrite,
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

/**
 * 剥离完整 content, 回列表元数据 (含纯文本摘要 + 全文), 避免列表整块载入正文。
 * withText=false 时跳过递归遍历块树取全文 (excerpt/search 留空) —— 供只需 标题/时间 的消费方
 * (如中枢回流时间线) 省掉对每条笔记的全文 walk。
 */
function toMeta(note: Note, withText = true): NoteMeta {
  const text = withText ? noteText(note.content) : ""
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
  await idbReadModifyWrite<Notebook>(STORE_NOTEBOOKS, id, (current) =>
    current ? { ...current, name: name.trim() || current.name } : undefined,
  )
}

/** 删除笔记本; 其下笔记移到未分组 (notebookId = null), 不删除笔记 */
export async function deleteNotebook(id: string): Promise<void> {
  const notes = await idbGetAll<Note>(STORE_NOTES)
  const orphans = notes.filter((n) => n.notebookId === id).map((n) => ({ ...n, notebookId: null }))
  if (orphans.length) await idbBulkPut(STORE_NOTES, orphans)
  await idbDelete(STORE_NOTEBOOKS, id)
  notifyHubUpdated()
}

// ---- 笔记 ----

/**
 * 列出所有笔记元数据 (不含完整 content), 按最后编辑时间倒序。
 * opts.text=false 跳过全文 walk (excerpt/search 留空), 供只用 标题/时间 的消费方提速。
 */
export async function listNotes(opts?: { text?: boolean }): Promise<NoteMeta[]> {
  const withText = opts?.text !== false
  const notes = await idbGetAll<Note>(STORE_NOTES)
  return notes.map((n) => toMeta(n, withText)).sort((a, b) => b.updatedAt - a.updatedAt)
}

/** 笔记数 —— 走 count(), 仅需数量徽标时用 (不遍历每条笔记的块树取全文)。 */
export async function countNotes(): Promise<number> {
  return idbCount(STORE_NOTES)
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
  // 单事务读-改-写: 正文自动保存与改标题并发时不丢更新 (旧实现读、写分两事务会互相覆盖)。
  const next = await idbReadModifyWrite<Note>(STORE_NOTES, id, (current) => {
    if (!current) return undefined
    // 兜底归一化损坏/空正文 (与 getNote 同口径), 避免把 [] 写回库。
    const normalized =
      !Array.isArray(current.content) || current.content.length === 0
        ? { ...current, content: emptyNoteContent() }
        : current
    return { ...normalized, ...patch, updatedAt: Date.now() }
  })
  if (next) notifyHubUpdated()
  return next
}

export async function deleteNote(id: string): Promise<void> {
  await idbDelete(STORE_NOTES, id)
  notifyHubUpdated()
}

/** 撤销删除: 把刚删除的笔记原样写回 (保留 id/时间/正文, 非新建)。 */
export async function restoreNote(note: Note): Promise<void> {
  await idbPut(STORE_NOTES, note)
  notifyHubUpdated()
}
