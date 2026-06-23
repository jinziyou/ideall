// 笔记「扁平笔记本 → 递归页树」迁移的纯转换 (与 IndexedDB I/O 解耦, 便于单测)。
// 输入旧 notes / noteNotebooks 原始记录, 输出要写入的 notes 全集 + 要清空的 noteNotebooks id。
// 纯本地、无服务端备份, 故正确性 (零丢数据 + 幂等) 由 notes-migrate.test.ts 锁死。
import type { Note, NoteContent } from "@protocol/hub-data"
import { sequentialSortKeys } from "./sort-key"

export type MigrationPlan = { puts: Note[]; deleteNotebookIds: string[] }

function emptyNoteContent(): NoteContent {
  return [{ type: "p", children: [{ text: "" }] }]
}
function asNum(x: unknown, fallback: number): number {
  return typeof x === "number" ? x : fallback
}
function asStr(x: unknown): string {
  return typeof x === "string" ? x : ""
}

/**
 * 规划一次迁移。返回 null = 无存量 / 已迁移 (幂等空操作)。
 * - 旧笔记本 → 根级目录页 Note (复用 notebook.id, 故子笔记 notebookId=X 直接成 parentId=X, 零重指)。
 * - 旧笔记 → 设 parentId (= notebookId; 指向不存在的笔记本则归根), 复制正文/标签/时间/墓碑。
 * - 同 parentId 组内: 目录页优先 (createdAt 升), 笔记其后 (updatedAt 降), 顺序发严格递增 sortKey。
 * - existingTreeIds (已带 sortKey 的记录) 不重建 → 崩溃后重跑幂等, 不覆盖已迁移节点。
 * now 注入 (缺失时间戳的兜底), 便于测试确定性。
 */
export function planNotesTreeMigration(
  rawNotes: Record<string, unknown>[],
  rawNotebooks: Record<string, unknown>[],
  now: number,
): MigrationPlan | null {
  const legacyNotes = rawNotes.filter((n) => "notebookId" in n || typeof n.sortKey !== "string")
  if (rawNotebooks.length === 0 && legacyNotes.length === 0) return null

  const existingTreeIds = new Set(
    rawNotes.filter((n) => typeof n.sortKey === "string").map((n) => n.id as string),
  )
  const notebookIds = new Set(rawNotebooks.map((nb) => nb.id as string))

  const dirDrafts: Note[] = rawNotebooks
    .filter((nb) => !existingTreeIds.has(nb.id as string))
    .map((nb) => ({
      id: nb.id as string,
      title: asStr(nb.name) || "未命名笔记本",
      content: emptyNoteContent(),
      parentId: null,
      sortKey: "",
      tags: [],
      createdAt: asNum(nb.createdAt, now),
      updatedAt: asNum(nb.createdAt, now),
    }))

  const noteDrafts: Note[] = legacyNotes.map((n) => {
    const oldNb = (n as { notebookId?: unknown }).notebookId
    const parentId = typeof oldNb === "string" && notebookIds.has(oldNb) ? oldNb : null
    const draft: Note = {
      id: n.id as string,
      title: asStr(n.title),
      content:
        Array.isArray(n.content) && n.content.length
          ? (n.content as NoteContent)
          : emptyNoteContent(),
      parentId,
      sortKey: "",
      tags: Array.isArray(n.tags) ? (n.tags as string[]) : [],
      createdAt: asNum(n.createdAt, now),
      updatedAt: asNum(n.updatedAt, now),
    }
    if (typeof (n as { deletedAt?: unknown }).deletedAt === "number") {
      draft.deletedAt = (n as { deletedAt: number }).deletedAt
    }
    return draft
  })

  const all = [...dirDrafts, ...noteDrafts]
  const isDir = new Set(dirDrafts.map((d) => d.id))
  const groups = new Map<string | null, Note[]>()
  for (const d of all) {
    const arr = groups.get(d.parentId) ?? []
    arr.push(d)
    groups.set(d.parentId, arr)
  }
  for (const group of groups.values()) {
    group.sort((a, b) => {
      const ad = isDir.has(a.id)
      const bd = isDir.has(b.id)
      if (ad !== bd) return ad ? -1 : 1
      if (ad && bd) return a.createdAt - b.createdAt
      return b.updatedAt - a.updatedAt
    })
    const keys = sequentialSortKeys(group.length)
    group.forEach((d, i) => {
      d.sortKey = keys[i]
    })
  }

  return { puts: all, deleteNotebookIds: [...notebookIds] }
}
