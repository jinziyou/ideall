// 「发现」订阅本地存储仓库 —— 折叠步 C 后物理统一到 nodes 仓库 (kind:"feed", 确定性 id feed:type:key)。
// 对外仍以 Subscription 域类型呈现 (节点↔Subscription 投影在本仓库边界), 消费方零改;
// **同步零改**: subscription-sync 仍走 "subs" scope, 经 listAllSubscriptions/bulkPutSubscriptions 读写,
// 本仓库把 feed 节点投影回旧 Subscription wire (id 由 content.type:key 重建 = 旧确定性 id, 跨端 LWW 一致)。
// 删除走软删墓碑 (deletedAt), 含墓碑全量参与同步合并 (漏带 = 已删订阅被对端复活)。
import type { Subscription, SubscriptionType, NewSubscription } from "@protocol/subscription"
import type { NodeKind, NodeOfKind } from "@protocol/node"
import { isLive, expiredTombstoneIdsToDelete } from "@protocol/sync"
import { safeHref } from "@/components/lib/safe-url"
import { sortKeyBetween } from "./sort-key"
import { feedNodeId, subToFeedNode, feedNodeToSub, planFeedsSeed } from "./nodes-migrate"
import {
  idbBulkDelete,
  idbBulkPut,
  idbBulkPutDelete,
  idbGet,
  idbGetAll,
  idbPut,
  STORE_NODES,
  STORE_SUBSCRIPTIONS,
} from "@/components/lib/idb"
import { notifyHubUpdated } from "./flowback"

type FeedNode = NodeOfKind<"feed">

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

// ---- 懒迁移: 折叠步 C —— 订阅播种进 nodes 仓库 (含墓碑全量) ----

let seedPromise: Promise<void> | null = null

/** 折叠步 C 懒迁移 (模块级 once): 旧 subscriptions 仓库 → feed 节点 (确定性 id), 清空旧仓库。 */
export function seedFeedsOnce(): Promise<void> {
  if (!seedPromise) {
    seedPromise = doSeedFeeds().catch((e) => {
      seedPromise = null
      throw e
    })
  }
  return seedPromise
}

async function doSeedFeeds(): Promise<void> {
  const [rawSubs, existingNodes] = await Promise.all([
    idbGetAll<Record<string, unknown>>(STORE_SUBSCRIPTIONS),
    idbGetAll<{ id: string }>(STORE_NODES),
  ])
  const plan = planFeedsSeed(rawSubs, new Set(existingNodes.map((n) => n.id)), Date.now())
  if (!plan) return // 旧仓库已空
  // 先写 feed 节点 (含墓碑) 再清旧仓库; 顺序 put→delete 不丢, existingNodeIds 探测幂等。
  if (plan.puts.length) await idbBulkPut(STORE_NODES, plan.puts)
  if (plan.drainSubIds.length) await idbBulkDelete(STORE_SUBSCRIPTIONS, plan.drainSubIds)
}

// ---- feed 节点读 + sortKey 追加 ----

async function allFeedNodes(): Promise<FeedNode[]> {
  const all = await idbGetAll<{ id: string; kind?: NodeKind }>(STORE_NODES)
  return all.filter((n): n is FeedNode => n.kind === "feed")
}

/** 同级最大 sortKey (含墓碑)。 */
function maxKey(nodes: { sortKey: string }[]): string | null {
  const keys = nodes
    .map((n) => n.sortKey)
    .filter((k) => typeof k === "string" && k.length > 0)
    .sort()
  return keys.length ? keys[keys.length - 1] : null
}

/** 自 after 起一个严格递增追加键 (订阅列表按 createdAt 展示, sortKey 仅供就绪)。 */
function nextKey(after: string | null): string {
  try {
    return sortKeyBetween(after, null)
  } catch {
    return sortKeyBetween(null, null)
  }
}

// ---- 读 (投影 feed 节点 → Subscription) ----

/** 列出活跃订阅 (过滤墓碑)。UI / 插件 / 嵌入桥读路径。 */
export async function listSubscriptions(): Promise<Subscription[]> {
  await seedFeedsOnce()
  return (await allFeedNodes())
    .filter(isLive)
    .map(feedNodeToSub)
    .sort((a, b) => b.createdAt - a.createdAt)
}

/** 列出全部订阅含墓碑 —— 仅跨端同步合并用 (墓碑需进合并/上传才能传播删除)。 */
export async function listAllSubscriptions(): Promise<Subscription[]> {
  await seedFeedsOnce()
  return (await allFeedNodes()).map(feedNodeToSub)
}

export async function isSubscribed(type: SubscriptionType, key: string): Promise<boolean> {
  await seedFeedsOnce()
  const n = await idbGet<FeedNode>(STORE_NODES, feedNodeId(type, key.trim()))
  return Boolean(n && n.kind === "feed" && isLive(n)) // 墓碑 / 非 feed 视为未订阅
}

// ---- 写 ----

/** 订阅; 活跃项已存在则原样返回 (幂等); 命中墓碑则复活 (清除 deletedAt + 新 updatedAt, 保留原 createdAt)。 */
export async function addSubscription(input: NewSubscription): Promise<Subscription> {
  await seedFeedsOnce()
  const key = input.key.trim()
  const id = feedNodeId(input.type, key)
  const existing = await idbGet<FeedNode>(STORE_NODES, id)
  if (existing && existing.kind === "feed" && isLive(existing)) return feedNodeToSub(existing) // 活跃 → 幂等
  // tool 订阅的 key 即启动 URL, 会渲染成 <a href>; 全写入路径 (嵌入桥 / agent / 手动) 的最后一道闸:
  // 拒非 http(s) 协议, 防伪协议 (javascript:/data:) 入库后被点击触发存储型 XSS。
  if (input.type === "tool" && !safeHref(key)) {
    throw new Error("工具链接必须是 http(s) 地址")
  }
  const sub: Subscription = {
    id: `${input.type}:${key}`,
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
  // sub 无 deletedAt → subToFeedNode 不写墓碑位 = 复活; 复用墓碑 sortKey, 全新则追加。
  const node = subToFeedNode(sub, existing?.sortKey || nextKey(maxKey(await allFeedNodes())))
  await idbPut(STORE_NODES, node)
  notifyHubUpdated()
  return sub
}

/**
 * 退订 —— 软删除: 写墓碑 (deletedAt) 而非物理删, 并 bump updatedAt 使其按 LWW 胜过对端旧副本,
 * 从而让删除跨端收敛。未订阅 / 已是墓碑则幂等无操作。
 */
export async function removeSubscription(type: SubscriptionType, key: string): Promise<void> {
  await seedFeedsOnce()
  const id = feedNodeId(type, key.trim())
  const existing = await idbGet<FeedNode>(STORE_NODES, id)
  if (!existing || existing.kind !== "feed" || !isLive(existing)) return // 未订阅 / 已墓碑 → 幂等
  const now = Date.now()
  await idbPut(STORE_NODES, { ...existing, deletedAt: now, updatedAt: now })
  notifyHubUpdated()
}

/**
 * 跨端同步落地 (sync 插件经 HubDataPort 调用): subs 是合并 + GC 后的权威全集 (含未过期墓碑, wire id=type:key)。
 * 投影回 feed 节点整批 put; 并物理删除「落地时刻 nodes 库中仍残留的过期 feed 墓碑」(据当前真实库, 仅限 feed kind)。
 */
export async function bulkPutSubscriptions(subs: Subscription[]): Promise<void> {
  await seedFeedsOnce()
  const existing = await allFeedNodes() // feed 作用域: 过期墓碑 GC 绝不波及其它 kind 节点
  const keyById = new Map(existing.map((n) => [n.id, n.sortKey]))
  let lastKey = maxKey(existing)
  const nodes = subs.map((sub) => {
    const nid = feedNodeId(sub.type, sub.key)
    let sk = keyById.get(nid)
    if (!sk) {
      sk = nextKey(lastKey) // 新订阅 → 追加键; 已存在 → 复用其 sortKey (不重排)
      lastKey = sk
    }
    return subToFeedNode(sub, sk)
  })
  const expired = expiredTombstoneIdsToDelete(existing, new Set(nodes.map((n) => n.id)), Date.now())
  if (nodes.length || expired.length) {
    // 写回合并全集 + 物理删过期墓碑同事务原子 (避免「已写回但墓碑未清」中间态)。
    await idbBulkPutDelete(STORE_NODES, nodes, expired)
    notifyHubUpdated()
  }
}
