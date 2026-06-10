// 跨端同步编排 (sync 插件) —— 本地优先 + 端到端加密。
// 拉远端密文 → 解密 → 与本地按 id 并集合并 → 写本地 → 加密 → 推远端。
// 合并为并集 (LWW), 删除为尽力 (会被另一端带回已删项)。
// 订阅读写经 @protocol/hub-data 的 HubDataPort (插件不直接依赖 core 存储)。
import type { Subscription } from "@protocol/subscription"
import { unionMerge, subsEqual, type SyncResult } from "@protocol/sync"
import { getHubData } from "@protocol/hub-data"
import { decryptJson, deriveKeys, encryptJson, isValidSyncCode } from "@/components/lib/sync-crypto"
import { getSyncBlob, putSyncBlob } from "./sync-action"

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

/** 执行一次同步。失败抛 Error (含可展示消息)。 */
export async function syncNow(code: string): Promise<SyncResult> {
  if (!isValidSyncCode(code)) throw new Error("同步码格式不正确")
  const { storageId, key } = await deriveKeys(code)
  const hub = getHubData()

  const local = await hub.listSubscriptions()

  let remote: Subscription[] = []
  const got = await getSyncBlob(storageId)
  if (!got.ok) throw new Error(got.message)
  if (got.data) {
    try {
      const decoded = await decryptJson<unknown[]>(key, got.data.iv, got.data.ciphertext)
      if (Array.isArray(decoded)) remote = decoded.filter(isValidRemoteSub)
    } catch {
      throw new Error("解密失败：同步码可能不一致")
    }
  }

  const merged = unionMerge(local, remote)
  // LWW 下即使长度不变也可能有字段更新, 故按"非等价就写回"判定。
  if (!subsEqual(merged, local)) {
    await hub.bulkPutSubscriptions(merged)
  }

  // 已知限制 (丢失更新窗口): 此处是无条件覆盖式 PUT, 未携带期望 updated_at。unionMerge 是逐订阅
  // LWW, 故并发只在"另一端在本端 GET 之后、本 PUT 之前新增了一条本端未持有的订阅"时丢该新订阅
  // (已有订阅的字段更新由 updatedAt 保护)。彻底修复需 super/server 支持乐观并发 (PUT 带 updated_at,
  // 冲突返 409 → 客户端重新 GET→merge→PUT), 属跨仓改动; 当前服务端仅 204/400/500, 暂记录于此。
  const enc = await encryptJson(key, merged)
  const put = await putSyncBlob(storageId, {
    iv: enc.iv,
    ciphertext: enc.ciphertext,
    updated_at: Date.now(),
  })
  if (!put.ok) throw new Error(put.message)

  // 精确统计"本地原本不存在的新 id 数"(LWW 下字段更新不算 added)。
  const localIds = new Set(local.map((s) => s.id))
  const added = merged.filter((s) => !localIds.has(s.id)).length
  return { total: merged.length, added }
}
