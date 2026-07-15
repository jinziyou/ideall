// 跨端同步编排 (sync 插件) —— 本地优先 + 端到端加密。
// 拉远端密文 → 解密 → 与本地 (含删除标记) 按 id 并集合并 (LWW) → GC 过期删除标记 → 写本地 → 加密 → 推远端。
// 编排由 sync-domain-machine (XState) 驱动; 本文件提供域配置与校验。
import {
  hasCanonicalSubscriptionIdentity,
  hasValidSubscriptionMetadata,
  isSubscriptionType,
  type Subscription,
} from "@protocol/subscription"
import {
  unionMerge,
  isSaneSyncTimestamp,
  pruneExpiredTombstones,
  type SyncResult,
} from "@protocol/sync"
import { getStorageSyncPort } from "@protocol/storage-sync"
import { safeHref } from "@/lib/safe-url"
import type { DomainSyncConfig } from "./sync-domain-runner"
import { runDomainSync } from "./sync-domain-machine"

/**
 * 远端项最小结构校验。AES-GCM 已防无密钥方篡改, 但持正确同步码的某端 (失陷/老旧) 仍可能上传缺字段/类型错误的项;
 * 尤其 id 缺失会让 unionMerge 以 undefined 作 Map 键、导致多条相互覆盖。过滤合并关键字段非法的项。
 */
function isValidRemoteSub(s: unknown, now: number): s is Subscription {
  if (!s || typeof s !== "object") return false
  const o = s as Record<string, unknown>
  if (typeof o.id !== "string" || !isSubscriptionType(o.type) || typeof o.key !== "string") {
    return false
  }
  return (
    hasCanonicalSubscriptionIdentity({ id: o.id, type: o.type, key: o.key }) &&
    (o.type !== "tool" || Boolean(safeHref(o.key))) &&
    typeof o.title === "string" &&
    typeof o.favicon === "string" &&
    hasValidSubscriptionMetadata(o) &&
    isSaneSyncTimestamp(o.createdAt, now) &&
    isSaneSyncTimestamp(o.updatedAt, now) &&
    (o.deletedAt === undefined || isSaneSyncTimestamp(o.deletedAt, now))
  )
}

/** 关注域同步配置 (供 XState domain machine / orchestrator 复用)。 */
export const subscriptionsSyncConfig: DomainSyncConfig<Subscription> = {
  listLocal: () => getStorageSyncPort().listAllSubscriptions(),
  merge: unionMerge,
  gc: pruneExpiredTombstones,
  bulkPut: (items, expectedLocal) =>
    getStorageSyncPort().bulkPutSubscriptions(items, expectedLocal),
  isValidRemote: isValidRemoteSub,
}

/** 执行一次关注同步。失败抛 Error (含可展示消息)。 */
export async function syncNow(code: string): Promise<SyncResult> {
  return runDomainSync(code, subscriptionsSyncConfig)
}
