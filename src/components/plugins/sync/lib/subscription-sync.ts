// 跨端同步编排 (sync 插件) —— 本地优先 + 端到端加密。
// 拉远端密文 → 解密 → 与本地按 id 并集合并 → 写本地 → 加密 → 推远端。
// 合并为并集 (LWW), 删除为尽力 (会被另一端带回已删项)。
// 订阅读写经 @protocol/hub-data 的 HubDataPort (插件不直接依赖 core 存储)。
import type { Subscription } from "@protocol/subscription"
import { unionMerge, subsEqual, type SyncResult } from "@protocol/sync"
import { getHubData } from "@protocol/hub-data"
import { decryptJson, deriveKeys, encryptJson, isValidSyncCode } from "@/components/lib/sync-crypto"
import { getSyncBlob, putSyncBlob } from "./sync-api"

/**
 * 远端项最小结构校验。AES-GCM 已防无密钥方篡改, 但持正确同步码的某端仍可能上传缺字段/类型错误的项;
 * 尤其 id 缺失会让 unionMerge 以 undefined 作 Map 键、导致多条相互覆盖。过滤合并关键字段非法的项。
 */
function isValidRemoteSub(s: unknown): s is Subscription {
  if (!s || typeof s !== "object") return false
  const o = s as Record<string, unknown>
  return (
    typeof o.id === "string" &&
    typeof o.type === "string" &&
    typeof o.key === "string" &&
    typeof o.title === "string"
  )
}

// 同步推送的最大尝试次数: 每次 409 (并发冲突) 后重新 GET→合并→PUT。有界以防对端高频写时死循环。
const SYNC_MAX_ATTEMPTS = 4

/** 执行一次同步。失败抛 Error (含可展示消息)。 */
export async function syncNow(code: string): Promise<SyncResult> {
  if (!isValidSyncCode(code)) throw new Error("同步码格式不正确")
  const { storageId, key } = await deriveKeys(code)
  const hub = getHubData()

  const local = await hub.listSubscriptions()
  // merged 跨重试累积: unionMerge 是按 id 的 LWW 并集 (幂等可结合), 故每轮并入新拉到的远端即可。
  let merged = local

  // 乐观并发: 携带本端读到的基线版本 PUT; 若服务端已被另一端更新 (409) → 重新 GET→合并→PUT。
  // 修复旧的"丢失更新"窗口: 另一端在本端 GET 之后、PUT 之前新增的订阅不再被无条件覆盖丢弃。
  for (let attempt = 1; ; attempt++) {
    const got = await getSyncBlob(storageId)
    if (!got.ok) throw new Error(got.message)
    const base = got.data?.updated_at ?? 0 // 尚无数据 → 基线 0 (期望服务端也无数据)
    let remote: Subscription[] = []
    if (got.data) {
      try {
        const decoded = await decryptJson<unknown[]>(key, got.data.iv, got.data.ciphertext)
        if (Array.isArray(decoded)) remote = decoded.filter(isValidRemoteSub)
      } catch {
        throw new Error("解密失败：同步码可能不一致")
      }
    }

    merged = unionMerge(merged, remote)
    // LWW 下即使长度不变也可能有字段更新, 故按"非等价就写回"判定。
    if (!subsEqual(merged, local)) {
      await hub.bulkPutSubscriptions(merged)
    }

    const enc = await encryptJson(key, merged)
    const put = await putSyncBlob(
      storageId,
      { iv: enc.iv, ciphertext: enc.ciphertext, updated_at: Date.now() },
      base,
    )
    if (put.ok) break
    // 409 = 并发冲突: 另一端已抢先更新, 重新拉取合并后再试 (有界); 其它错误直接抛。
    if (put.status === 409 && attempt < SYNC_MAX_ATTEMPTS) continue
    if (put.status === 409) throw new Error("同步冲突: 多端同时修改, 请稍后重试")
    throw new Error(put.message)
  }

  // 精确统计"本地原本不存在的新 id 数"(LWW 下字段更新不算 added)。
  const localIds = new Set(local.map((s) => s.id))
  const added = merged.filter((s) => !localIds.has(s.id)).length
  return { total: merged.length, added }
}
