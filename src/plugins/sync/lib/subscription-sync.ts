// 跨端同步编排 (sync 插件) —— 本地优先 + 端到端加密。
// 拉远端密文 → 解密 → 与本地按 id 并集合并 → 写本地 → 加密 → 推远端。
// 合并为并集 (LWW), 删除为尽力 (会被另一端带回已删项)。
// 订阅读写经 @protocol/hub-data 的 HubDataPort (插件不直接依赖 core 存储)。
import type { Subscription } from "@protocol/subscription"
import { unionMerge, subsEqual, type SyncResult } from "@protocol/sync"
import { getHubData } from "@protocol/hub-data"
import { decryptJson, deriveKeys, encryptJson, isValidSyncCode } from "@/lib/sync-crypto"
import { getSyncBlob, putSyncBlob } from "./sync-action"

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
      const decoded = await decryptJson<Subscription[]>(key, got.data.iv, got.data.ciphertext)
      if (Array.isArray(decoded)) remote = decoded
    } catch {
      throw new Error("解密失败: 同步码可能不一致")
    }
  }

  const merged = unionMerge(local, remote)
  // LWW 下即使长度不变也可能有字段更新, 故按"非等价就写回"判定。
  if (!subsEqual(merged, local)) {
    await hub.bulkPutSubscriptions(merged)
  }

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
