// 「发现」订阅本地存储仓库 —— 基于 IndexedDB。
// home 从 info / community / tool 订阅来源 (发布者 / 实体 / 工具 / 搜索); 仅订阅偏好存本地, 内容实时拉取。
import type { Subscription, SubscriptionType, NewSubscription } from "@protocol/subscription"
import {
  idbBulkPut,
  idbDelete,
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

export async function listSubscriptions(): Promise<Subscription[]> {
  const items = await idbGetAll<Subscription>(STORE_SUBSCRIPTIONS)
  return items.sort((a, b) => b.createdAt - a.createdAt)
}

export async function isSubscribed(type: SubscriptionType, key: string): Promise<boolean> {
  return Boolean(await idbGet<Subscription>(STORE_SUBSCRIPTIONS, subId(type, key)))
}

/** 订阅; 已存在则原样返回 (幂等, 保留原 createdAt)。 */
export async function addSubscription(input: NewSubscription): Promise<Subscription> {
  const id = subId(input.type, input.key)
  const existing = await idbGet<Subscription>(STORE_SUBSCRIPTIONS, id)
  if (existing) return existing
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
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  await idbPut(STORE_SUBSCRIPTIONS, sub)
  notifyHubUpdated()
  return sub
}

export async function removeSubscription(type: SubscriptionType, key: string): Promise<void> {
  await idbDelete(STORE_SUBSCRIPTIONS, subId(type, key))
  notifyHubUpdated()
}

/** 批量写入 (跨端同步合并后整批落本地, 一次事务)。 */
export async function bulkPutSubscriptions(subs: Subscription[]): Promise<void> {
  if (subs.length) {
    await idbBulkPut(STORE_SUBSCRIPTIONS, subs)
    notifyHubUpdated()
  }
}
