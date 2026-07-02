// 笔记跨端同步编排 (sync 插件) —— 本地优先 + 端到端加密, 与关注同构但走独立加密块 (notes scope)。
// 拉远端密文 → 解密 → 与本地按 id 合并 → GC 过期删除标记 → 写本地 → 加密 → 推远端。
// 合并 (§7): 整篇删除走 node 级 LWW (deletedAt); 正文走**块级合并** (mergeNoteContent) —— 跨端并发改不同块
// 无损、同块并发 LWW 一方胜 (§7.5); 标题/标签按整篇 updatedAt LWW。块级删除标记的 GC 与合并分离 (§7.4)。
// 取舍记录见 docs/sync-lww-tradeoff.md。笔记读写经 @protocol/files 的 FilesPort (不直接依赖 core 存储)。
//
// 注: 当前笔记整篇随每次同步重新加密上传 (单 blob)。块级 v 已支撑只传变更块, 改增量上传属后续性能优化。
import type { Note } from "@protocol/files"
import { getFilesPort } from "@protocol/files"
import {
  recordsEqual,
  isLive,
  isSaneSyncTimestamp,
  pruneExpiredTombstones,
  type SyncResult,
} from "@protocol/sync"
import { mergeNoteContent, pruneBlockTombstones, type Block } from "@protocol/note-merge"
import { decryptJson, deriveKeys, encryptJson, isValidSyncCode } from "@/lib/sync-crypto"
import { getSyncBlob, putSyncBlob } from "./sync-api"

const noteTs = (n: Note): number => n.updatedAt

const hasBlocks = (n: Note): boolean => !!n.blockMeta && Object.keys(n.blockMeta).length > 0

/** 合并两份同 id 笔记: 整篇删除/标题/标签按 updatedAt LWW; 两边都已块级就绪则正文走块级合并 (§7)。 */
export function mergeTwoNotes(a: Note, b: Note): Note {
  const winner = noteTs(a) >= noteTs(b) ? a : b
  // 较新一方是删除标记 → 整篇删除胜 (node 级 LWW, 块合并无意义)。
  if (winner.deletedAt != null) return { ...winner }
  // 块级合并仅当两边都有 blockMeta —— 缺一方 (旧记录 / 未升级老端) 则整篇 LWW 兜底, 否则 mergeNoteContent
  // 遇空 meta 会因无块元数据而重建出空正文 → 丢内容。两端都升级且都写过笔记后, 块级合并自然生效。
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

/** 合并后 GC: node 级过期删除标记 (剔整条) + 每条笔记的块级过期删除标记 (§7.4 单独一步)。 */
function gcNotes(notes: Note[], now: number): Note[] {
  return pruneExpiredTombstones(notes, now).map((n) =>
    n.blockMeta ? { ...n, blockMeta: pruneBlockTombstones(n.blockMeta, now) } : n,
  )
}

/** blockMeta 形状校验: 缺省合法 (blockMeta 本就可选 —— 空正文/未块级就绪的笔记走整篇 LWW 兜底);
 *  存在则每项须 {v:number, by:string, sk:string, del?:number}。
 *  块级删除标记的 del 须有界 (远未来 del 会逃过块级删除标记 GC 成永不清除的删除标记), 与 node 级 deletedAt 同口径。 */
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

/**
 * 远端笔记最小结构校验。AES-GCM 已防无密钥方篡改, 但持正确同步码的某端仍可能上传缺字段/类型错误的项;
 * 尤其 id / sortKey / parentId 非法会污染 LWW 合并与树重建。过滤合并关键字段非法的项。
 * content 须为对象数组 (null 元素会让 blockMapById 取 .id 崩溃 → 一条投毒笔记瘫痪全端同步);
 * blockMeta 须类型正确 (脏 v 会破坏 pickMeta 的可交换性 → 合并不收敛/churn; 脏 del 会逃过删除标记 GC)。
 */
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
    // 时间戳须有界 (防远未来 updatedAt 永久赢 LWW 钉死被投毒笔记 / 远未来 deletedAt 造永不清除的删除标记)。
    isSaneSyncTimestamp(o.createdAt, now) &&
    isSaneSyncTimestamp(o.updatedAt, now) &&
    (o.deletedAt === undefined || isSaneSyncTimestamp(o.deletedAt, now)) &&
    isValidBlockMeta(o.blockMeta, now)
  )
}

// 同步推送的最大尝试次数: 每次 409 (并发冲突) 后重新 GET→合并→PUT。有界以防对端高频写时死循环。
const SYNC_MAX_ATTEMPTS = 4

/** 执行一次笔记同步。失败抛 Error (含可展示消息)。 */
export async function syncNotes(code: string): Promise<SyncResult> {
  if (!isValidSyncCode(code)) throw new Error("同步码格式不正确")
  const { storageId, key } = await deriveKeys(code, "notes")
  const filesPort = getFilesPort()
  const now = Date.now() // 入站时间戳上界基准 (整次同步用同一基准即可, 窗口远大于同步耗时)

  // 含删除标记 + 完整正文读: 删除靠删除标记进合并/上传才能传播; 读路径 (UI) 另有 listNotes 过滤删除标记。
  const localAll = await filesPort.listAllNotes()
  let merged = localAll
  let kept = localAll

  let succeeded = false
  for (let attempt = 1; attempt <= SYNC_MAX_ATTEMPTS; attempt++) {
    const got = await getSyncBlob(storageId)
    if (!got.ok) throw new Error(got.message)
    const base = got.data?.updated_at ?? 0
    let remote: Note[] = []
    if (got.data) {
      try {
        const decoded = await decryptJson<unknown[]>(key, got.data.iv, got.data.ciphertext)
        if (Array.isArray(decoded)) remote = decoded.filter((x) => isValidRemoteNote(x, now))
      } catch {
        throw new Error("解密失败：同步码可能不一致")
      }
    }

    merged = mergeNotes(merged, remote)
    kept = gcNotes(merged, Date.now())
    if (!recordsEqual(kept, localAll)) {
      await filesPort.bulkPutNotes(kept)
    }

    const enc = await encryptJson(key, kept)
    const put = await putSyncBlob(
      storageId,
      { iv: enc.iv, ciphertext: enc.ciphertext, updated_at: Date.now() },
      base,
    )
    if (put.ok) {
      succeeded = true
      break
    }
    if (put.status === 409 && attempt < SYNC_MAX_ATTEMPTS) continue
    if (put.status === 409) throw new Error("同步冲突: 多端同时修改, 请稍后重试")
    throw new Error(put.message)
  }
  if (!succeeded) throw new Error("同步失败: 超过最大重试次数, 请稍后再试")

  const localLiveIds = new Set(localAll.filter(isLive).map((s) => s.id))
  const mergedLive = kept.filter(isLive)
  const added = mergedLive.filter((s) => !localLiveIds.has(s.id)).length
  return { total: mergedLive.length, added }
}
