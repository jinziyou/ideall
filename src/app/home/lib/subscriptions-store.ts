// 「发现」订阅本地存储仓库 —— 基于 IndexedDB。
// home 从 info / community / tool 订阅来源 (发布者 / 实体 / 工具 / 搜索); 仅订阅偏好存本地, 内容实时拉取。
import type { Subscription, SubscriptionType, NewSubscription } from "@protocol/subscription"
import { isLive, expiredTombstoneIdsToDelete } from "@protocol/sync"
import {
  idbBulkPutDelete,
  idbGet,
  idbGetAll,
  idbPut,
  STORE_SUBSCRIPTIONS,
} from "@/components/lib/idb"
import { notifyHubUpdated } from "./flowback"

/** 由域名推断 favicon (Google s2 服务); 域名为空时降级为空串。 */
export function faviconForDomain(domain: string): string {
  const host = domain.trim()
  return host ? `https://www.google.com/s2/favicons?domain=${host}&sz=64` : ""
}

/** 由完整 URL 推断 favicon (取 hostname); 解析失败降级为空串。 */
export function faviconForUrl(url: string): string {
  try {
    return faviconForDomain(new URL(url).hostname)
  } catch {
    return ""
  }
}

/** 订阅去重键: 同类型下唯一 (发布者用 domain), 直接用作 IndexedDB 主键, 保证幂等订阅。 */
function subId(type: SubscriptionType, key: string): string {
  return `${type}:${key}`
}

/** 列出活跃订阅 (过滤墓碑)。UI / 插件 / 嵌入桥读路径。 */
export async function listSubscriptions(): Promise<Subscription[]> {
  const items = await idbGetAll<Subscription>(STORE_SUBSCRIPTIONS)
  return items.filter(isLive).sort((a, b) => b.createdAt - a.createdAt)
}

/** 列出全部订阅含墓碑 —— 仅跨端同步合并用 (墓碑需进合并/上传才能传播删除)。 */
export async function listAllSubscriptions(): Promise<Subscription[]> {
  return idbGetAll<Subscription>(STORE_SUBSCRIPTIONS)
}

export async function isSubscribed(type: SubscriptionType, key: string): Promise<boolean> {
  const s = await idbGet<Subscription>(STORE_SUBSCRIPTIONS, subId(type, key))
  return Boolean(s && isLive(s)) // 墓碑视为未订阅
}

/** 订阅; 活跃项已存在则原样返回 (幂等); 命中墓碑则复活 (清除 deletedAt + 新 updatedAt, 保留原 createdAt)。 */
export async function addSubscription(input: NewSubscription): Promise<Subscription> {
  const id = subId(input.type, input.key)
  const existing = await idbGet<Subscription>(STORE_SUBSCRIPTIONS, id)
  if (existing && isLive(existing)) return existing // 活跃订阅 → 幂等
  const key = input.key.trim()
  const sub: Subscription = {
    id,
    type: input.type,
    key,
    title: input.title.trim() || key,
    favicon:
      input.favicon ||
      (input.type === "publisher"
        ? faviconForDomain(key)
        : input.type === "tool"
          ? faviconForUrl(key)
          : ""),
    ...(input.type === "entity"
      ? { entityLabel: input.entityLabel, entityName: input.entityName }
      : {}),
    ...(input.type === "search"
      ? { searchKeyword: input.searchKeyword, searchDomain: input.searchDomain }
      : {}),
    // 复活墓碑时保留原 createdAt (概念上同一订阅又回来了); 全新订阅则取 now。
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(), // 新 updatedAt 保证 LWW 胜过墓碑 (复活) / 旧远端项
  }
  await idbPut(STORE_SUBSCRIPTIONS, sub) // 不含 deletedAt → 清除墓碑
  notifyHubUpdated()
  return sub
}

/**
 * 退订 —— 软删除: 写墓碑 (deletedAt) 而非物理删, 并 bump updatedAt 使其按 LWW 胜过对端旧副本,
 * 从而让删除跨端收敛 (否则另一端会把已删项带回 = 复活)。未订阅 / 已是墓碑则幂等无操作。
 */
export async function removeSubscription(type: SubscriptionType, key: string): Promise<void> {
  const existing = await idbGet<Subscription>(STORE_SUBSCRIPTIONS, subId(type, key))
  if (!existing || !isLive(existing)) return // 未订阅 或 已是墓碑 → 幂等
  const now = Date.now()
  await idbPut(STORE_SUBSCRIPTIONS, { ...existing, deletedAt: now, updatedAt: now })
  notifyHubUpdated()
}

/**
 * 跨端同步落地: subs 是合并 + GC 后的权威全集 (含未过期墓碑)。整批 put;
 * 并物理删除「落地时刻库中**仍残留的过期墓碑**」—— 据当前真实库状态 (fresh 重读) 而非调用方同步快照判定,
 * 故绝不误删同步往返窗口内并发新增的活跃订阅 (本轮未上传, 下轮自然带上), 也不删正被写回的复活项。
 */
export async function bulkPutSubscriptions(subs: Subscription[]): Promise<void> {
  const existing = await idbGetAll<Subscription>(STORE_SUBSCRIPTIONS)
  const expired = expiredTombstoneIdsToDelete(existing, new Set(subs.map((s) => s.id)), Date.now())
  if (subs.length || expired.length) {
    // 写回合并全集 + 物理删过期墓碑同事务原子: 避免 put 成功后 delete 中断的「已写回但墓碑未清」中间态。
    await idbBulkPutDelete(STORE_SUBSCRIPTIONS, subs, expired)
    notifyHubUpdated()
  }
}
