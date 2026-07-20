// 笔记跨端同步编排 (sync 插件) —— 本地优先 + 端到端加密, 与关注同构但走独立加密块 (notes scope)。
// 合并 (§7): 整篇删除 node 级 LWW; 正文块级 mergeNoteContent。编排由 sync-domain-machine (XState) 驱动。
import type { Note } from "@protocol/files"
import { getStorageSyncPort } from "@protocol/storage-sync"
import {
  isSaneSyncTimestamp,
  pruneExpiredTombstones,
  SYNC_BLOCK_BUDGETS,
  type SyncResult,
} from "@protocol/sync"
import { mergeNoteContent, pruneBlockTombstones, type Block } from "@protocol/note-merge"
import type { DomainSyncConfig } from "./sync-domain-runner"
import { runDomainSync } from "./sync-domain-machine"

const noteTs = (n: Note): number => n.updatedAt

const hasBlocks = (n: Note): boolean => !!n.blockMeta && Object.keys(n.blockMeta).length > 0

/** 合并两份同 id 笔记: 整篇删除/标题/标签按 updatedAt LWW; 两边都已块级就绪则正文走块级合并 (§7)。 */
export function mergeTwoNotes(a: Note, b: Note): Note {
  const winner = noteTs(a) >= noteTs(b) ? a : b
  if (winner.deletedAt != null) return { ...winner }
  if (!hasBlocks(a) || !hasBlocks(b)) return { ...winner }
  const merged = mergeNoteContent(
    a.content as Block[],
    a.blockMeta ?? {},
    b.content as Block[],
    b.blockMeta ?? {},
  )
  return {
    ...winner,
    content: merged.content,
    blockMeta: merged.blockMeta,
    createdAt: Math.min(a.createdAt, b.createdAt),
    updatedAt: Math.max(noteTs(a), noteTs(b)),
    deletedAt: undefined,
  }
}

/** 按 id 合并两份笔记集 (同 id 走 mergeTwoNotes; 单边直取)。块级版的 unionMerge。 */
export function mergeNotes(local: Note[], remote: Note[]): Note[] {
  const map = new Map<string, Note>()
  for (const r of remote) map.set(r.id, r)
  for (const l of local) {
    const r = map.get(l.id)
    map.set(l.id, r ? mergeTwoNotes(l, r) : l)
  }
  return [...map.values()]
}

function gcNotes(notes: Note[], now: number): Note[] {
  return pruneExpiredTombstones(notes, now).map((n) =>
    n.blockMeta ? { ...n, blockMeta: pruneBlockTombstones(n.blockMeta, now) } : n,
  )
}

function isValidBlockMeta(bm: unknown, now: number): boolean {
  if (bm == null) return true
  if (typeof bm !== "object") return false
  for (const v of Object.values(bm as Record<string, unknown>)) {
    if (!v || typeof v !== "object") return false
    const m = v as Record<string, unknown>
    if (typeof m.v !== "number" || typeof m.by !== "string" || typeof m.sk !== "string")
      return false
    if (m.del !== undefined && !isSaneSyncTimestamp(m.del, now)) return false
  }
  return true
}

export function isValidRemoteNote(s: unknown, now: number = Date.now()): s is Note {
  if (!s || typeof s !== "object") return false
  const o = s as Record<string, unknown>
  return (
    typeof o.id === "string" &&
    typeof o.title === "string" &&
    (o.parentId === null || typeof o.parentId === "string") &&
    typeof o.sortKey === "string" &&
    Array.isArray(o.content) &&
    o.content.every((it) => it != null && typeof it === "object") &&
    Array.isArray(o.tags) &&
    isSaneSyncTimestamp(o.createdAt, now) &&
    isSaneSyncTimestamp(o.updatedAt, now) &&
    (o.deletedAt === undefined || isSaneSyncTimestamp(o.deletedAt, now)) &&
    isValidBlockMeta(o.blockMeta, now)
  )
}

/** 笔记域同步配置 (供 XState domain machine / orchestrator 复用)。 */
export const notesSyncConfig: DomainSyncConfig<Note> = {
  keyScope: "notes",
  budget: SYNC_BLOCK_BUDGETS.notes,
  listLocal: () => getStorageSyncPort().listAllNotes(),
  merge: mergeNotes,
  gc: gcNotes,
  bulkPut: (items, expectedLocal) => getStorageSyncPort().bulkPutNotes(items, expectedLocal),
  isValidRemote: isValidRemoteNote,
}

/** 执行一次笔记同步。失败抛 Error (含可展示消息)。 */
export async function syncNotes(code: string): Promise<SyncResult> {
  return runDomainSync(code, notesSyncConfig)
}
