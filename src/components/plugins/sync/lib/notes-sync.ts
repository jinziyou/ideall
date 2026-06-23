// 笔记跨端同步编排 (sync 插件) —— 本地优先 + 端到端加密, 与订阅同构但走独立加密块 (notes scope)。
// 拉远端密文 → 解密 → 与本地 (含墓碑) 按 id 并集合并 (LWW) → GC 过期墓碑 → 写本地 → 加密 → 推远端。
// 复用 @protocol/sync 的泛型合并 (unionMerge / pruneExpiredTombstones / recordsEqual); 删除以墓碑传播。
// 取舍记录见 docs/sync-lww-tradeoff.md。笔记读写经 @protocol/hub-data 的 HubDataPort (不直接依赖 core 存储)。
//
// 注: 当前笔记整篇随每次同步重新加密上传 (单 blob, 与订阅一致)。正文体量远大于订阅, 重度用户宜后续
// 改 changed-since / 分块上传以省带宽 —— 属性能优化, 非正确性问题。
import type { Note } from "@protocol/hub-data"
import { getHubData } from "@protocol/hub-data"
import { unionMerge, recordsEqual, isLive, pruneExpiredTombstones, type SyncResult } from "@protocol/sync"
import { decryptJson, deriveKeys, encryptJson, isValidSyncCode } from "@/components/lib/sync-crypto"
import { getSyncBlob, putSyncBlob } from "./sync-api"

/**
 * 远端笔记最小结构校验。AES-GCM 已防无密钥方篡改, 但持正确同步码的某端仍可能上传缺字段/类型错误的项;
 * 尤其 id / sortKey / parentId 非法会污染 LWW 合并与树重建。过滤合并关键字段非法的项。
 */
function isValidRemoteNote(s: unknown): s is Note {
  if (!s || typeof s !== "object") return false
  const o = s as Record<string, unknown>
  return (
    typeof o.id === "string" &&
    typeof o.title === "string" &&
    (o.parentId === null || typeof o.parentId === "string") &&
    typeof o.sortKey === "string" &&
    Array.isArray(o.content) &&
    Array.isArray(o.tags) &&
    typeof o.createdAt === "number" &&
    typeof o.updatedAt === "number" &&
    (o.deletedAt === undefined || typeof o.deletedAt === "number")
  )
}

// 同步推送的最大尝试次数: 每次 409 (并发冲突) 后重新 GET→合并→PUT。有界以防对端高频写时死循环。
const SYNC_MAX_ATTEMPTS = 4

/** 执行一次笔记同步。失败抛 Error (含可展示消息)。 */
export async function syncNotes(code: string): Promise<SyncResult> {
  if (!isValidSyncCode(code)) throw new Error("同步码格式不正确")
  const { storageId, key } = await deriveKeys(code, "notes")
  const hub = getHubData()

  // 含墓碑 + 完整正文读: 删除靠墓碑进合并/上传才能传播; 读路径 (UI) 另有 listNotes 过滤墓碑。
  const localAll = await hub.listAllNotes()
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
        if (Array.isArray(decoded)) remote = decoded.filter(isValidRemoteNote)
      } catch {
        throw new Error("解密失败：同步码可能不一致")
      }
    }

    merged = unionMerge(merged, remote)
    kept = pruneExpiredTombstones(merged, Date.now())
    if (!recordsEqual(kept, localAll)) {
      await hub.bulkPutNotes(kept)
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
