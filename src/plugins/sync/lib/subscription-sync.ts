// 跨端同步编排 (sync 插件) —— 本地优先 + 端到端加密。
// 拉远端密文 → 解密 → 与本地 (含删除标记) 按 id 并集合并 (LWW) → GC 过期删除标记 → 写本地 → 加密 → 推远端。
// 合并为并集 (LWW); 删除以删除标记传播 (软删 deletedAt, 按 LWW 跨端收敛, 不再被对端恢复); 过期删除标记 GC。
// 取舍记录见 docs/sync-lww-tradeoff.md。关注读写经 @protocol/files 的 FilesPort (插件不直接依赖 core 存储)。
import type { Subscription } from "@protocol/subscription"
import {
  unionMerge,
  recordsEqual,
  isLive,
  isSaneSyncTimestamp,
  pruneExpiredTombstones,
  type SyncResult,
} from "@protocol/sync"
import { getFilesPort } from "@protocol/files"
import { decryptJson, deriveKeys, encryptJson, isValidSyncCode } from "@/lib/sync-crypto"
import { getSyncBlob, putSyncBlob } from "./sync-api"

/**
 * 远端项最小结构校验。AES-GCM 已防无密钥方篡改, 但持正确同步码的某端 (失陷/老旧) 仍可能上传缺字段/类型错误的项;
 * 尤其 id 缺失会让 unionMerge 以 undefined 作 Map 键、导致多条相互覆盖。过滤合并关键字段非法的项。
 * 时间戳须有界 (isSaneSyncTimestamp): 远未来 createdAt/updatedAt 会永远赢 LWW 钉死被投毒项, 远未来 deletedAt
 * 会造 GC 清不掉的永久残留删除标记。createdAt/updatedAt 必填 (当前写入方一律带; 缺失即非法记录, 拒之)。
 */
function isValidRemoteSub(s: unknown, now: number): s is Subscription {
  if (!s || typeof s !== "object") return false
  const o = s as Record<string, unknown>
  return (
    typeof o.id === "string" &&
    typeof o.type === "string" &&
    typeof o.key === "string" &&
    typeof o.title === "string" &&
    isSaneSyncTimestamp(o.createdAt, now) &&
    isSaneSyncTimestamp(o.updatedAt, now) &&
    // 删除标记亦合法 (deletedAt 缺省=活跃, 有则须为有界数字); 非法/远未来类型会污染 LWW 比较或造永久残留删除标记。
    (o.deletedAt === undefined || isSaneSyncTimestamp(o.deletedAt, now))
  )
}

// 同步推送的最大尝试次数: 每次 409 (并发冲突) 后重新 GET→合并→PUT。有界以防对端高频写时死循环。
const SYNC_MAX_ATTEMPTS = 4

/** 执行一次同步。失败抛 Error (含可展示消息)。 */
export async function syncNow(code: string): Promise<SyncResult> {
  if (!isValidSyncCode(code)) throw new Error("同步码格式不正确")
  const { storageId, key } = await deriveKeys(code)
  const filesPort = getFilesPort()
  const now = Date.now() // 入站时间戳上界基准 (整次同步用同一基准即可, 窗口远大于同步耗时)

  // 含删除标记读: 删除靠删除标记进合并/上传才能传播; 读路径 (UI) 另有 listSubscriptions 过滤删除标记。
  const localAll = await filesPort.listAllSubscriptions()
  // merged 跨重试累积: unionMerge 是按 id 的 LWW 并集 (幂等可结合), 故每轮并入新拉到的远端即可。
  let merged = localAll
  // kept = merged GC 掉过期删除标记后的完整数据 (落地 + 上传的就是它); 成功后用于统计。
  let kept = localAll

  // 乐观并发: 携带本端读到的基线版本 PUT; 若服务端已被另一端更新 (409) → 重新 GET→合并→PUT。
  // 修复旧的"丢失更新"窗口: 另一端在本端 GET 之后、PUT 之前新增的关注不再被无条件覆盖丢弃。
  let succeeded = false
  for (let attempt = 1; attempt <= SYNC_MAX_ATTEMPTS; attempt++) {
    const got = await getSyncBlob(storageId)
    if (!got.ok) throw new Error(got.message)
    const base = got.data?.updated_at ?? 0 // 尚无数据 → 基线 0 (期望服务端也无数据)
    let remote: Subscription[] = []
    let remoteDirty = false // 远端 blob 含非法/被过滤项 → 即使集合等价也重传以清洗
    if (got.data) {
      try {
        const decoded = await decryptJson<unknown[]>(key, got.data.iv, got.data.ciphertext)
        if (Array.isArray(decoded)) {
          remote = decoded.filter((x) => isValidRemoteSub(x, now))
          remoteDirty = remote.length !== decoded.length
        } else {
          remoteDirty = true
        }
      } catch {
        throw new Error("解密失败：同步码可能不一致")
      }
    }

    merged = unionMerge(merged, remote)
    // GC: 落地/上传前剔除过期删除标记, 使本地与远端同步块都不再无限累积删除标记。
    kept = pruneExpiredTombstones(merged, Date.now())
    // LWW 下即使长度不变也可能有字段更新 (含删除标记), 故按"非等价就写回"判定; 写回会物理清除过期删除标记。
    if (!recordsEqual(kept, localAll)) {
      await filesPort.bulkPutSubscriptions(kept)
    }

    // 合并结果与远端等价且远端干净 → 跳过重新加密与上传 (无变更的周期同步只下载)。
    // 等价判定按序列化逐字比较, 偶发误判只会退化为照常上传 (fail-open), 不影响正确性。
    if (!remoteDirty && recordsEqual(kept, remote)) {
      succeeded = true
      break
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
    // 409 = 并发冲突: 另一端已抢先更新, 重新拉取合并后再试 (有界); 其它错误直接抛。
    if (put.status === 409 && attempt < SYNC_MAX_ATTEMPTS) continue
    if (put.status === 409) throw new Error("同步冲突: 多端同时修改, 请稍后重试")
    throw new Error(put.message)
  }
  // 兜底: 正常路径循环内必 break/throw; 走到此处说明重试耗尽 (理论不可达, 防未来新增分支漏 break/throw 致空转)。
  if (!succeeded) throw new Error("同步失败: 超过最大重试次数, 请稍后再试")

  // 统计以活跃关注 (非删除标记) 为口径: total = 合并后活跃数; added = 本地原本不存在的新活跃 id 数。
  const localLiveIds = new Set(localAll.filter(isLive).map((s) => s.id))
  const mergedLive = kept.filter(isLive)
  const added = mergedLive.filter((s) => !localLiveIds.has(s.id)).length
  return { total: mergedLive.length, added }
}
