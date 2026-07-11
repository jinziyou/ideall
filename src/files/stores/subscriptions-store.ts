// 「发现」关注本地存储仓库 —— 折叠步 C 后物理统一到 nodes 仓库 (kind:"feed", 确定性 id feed:type:key)。
// 对外仍以 Subscription 域类型呈现 (节点↔Subscription 映射在本仓库边界), 消费方零改;
// 同步仍走 "subs" scope, 但原始全量/bulk 能力已独立收口到 StorageSyncPort,
// 本仓库把 feed 节点映射回旧 Subscription wire (id 由 content.type:key 重建 = 旧确定性 id, 跨端 LWW 一致)。
// 删除走软删标记 (deletedAt), 含删除标记全量参与同步合并 (漏带 = 已删关注被对端恢复)。
import type { Subscription, SubscriptionType, NewSubscription } from "@protocol/subscription"
import type { NodeKind, NodeOfKind } from "@protocol/node"
import { isLive, expiredTombstoneIdsToDelete } from "@protocol/sync"
import { faviconForDomain, faviconForUrl } from "@/lib/favicon"
import { safeHref } from "@/lib/safe-url"
import { sortKeyBetween } from "@/files/sort-key"
import { feedNodeId, subToFeedNode, feedNodeToSub } from "@/files/feed-node"
import {
  idbBulkPutDelete,
  idbGet,
  idbGetAllFromIndex,
  idbPut,
  INDEX_NODES_KIND,
  STORE_NODES,
} from "@/lib/idb"
import { notifyFilesUpdated } from "@protocol/flowback"
import { captureTrashSnapshot } from "@/files/stores/trash-store"
import { nextUpdatedAt } from "@/files/version"

type FeedNode = NodeOfKind<"feed">

// ---- feed 节点读 + sortKey 追加 ----

async function allFeedNodes(): Promise<FeedNode[]> {
  const all = await idbGetAllFromIndex<{ id: string; kind?: NodeKind }>(
    STORE_NODES,
    INDEX_NODES_KIND,
    "feed",
  )
  return all.filter((n): n is FeedNode => n.kind === "feed")
}

/** 同级最大 sortKey (含删除标记)。 */
function maxKey(nodes: { sortKey: string }[]): string | null {
  const keys = nodes
    .map((n) => n.sortKey)
    .filter((k) => typeof k === "string" && k.length > 0)
    .sort()
  return keys.length ? keys[keys.length - 1] : null
}

/** 自 after 起一个严格递增追加键 (关注列表按 createdAt 展示, sortKey 仅供就绪)。 */
function nextKey(after: string | null): string {
  try {
    return sortKeyBetween(after, null)
  } catch {
    return sortKeyBetween(null, null)
  }
}

// ---- 读 (映射 feed 节点 → Subscription) ----

/** 列出活跃关注 (过滤删除标记)。UI / 插件 / 嵌入桥读路径。 */
export async function listSubscriptions(): Promise<Subscription[]> {
  return (await allFeedNodes())
    .filter(isLive)
    .map(feedNodeToSub)
    .sort((a, b) => b.createdAt - a.createdAt)
}

/** 按类型筛选活跃关注 (侧栏 info/community 用)。 */
export async function listSubscriptionsByTypes(types: SubscriptionType[]): Promise<Subscription[]> {
  if (types.length === 0) return []
  const want = new Set(types)
  return (await listSubscriptions()).filter((s) => want.has(s.type))
}

/** 列出全部关注含删除标记 —— 仅跨端同步合并用 (删除标记需进合并/上传才能传播删除)。 */
export async function listAllSubscriptions(): Promise<Subscription[]> {
  return (await allFeedNodes()).map(feedNodeToSub)
}

export async function isSubscribed(type: SubscriptionType, key: string): Promise<boolean> {
  const n = await idbGet<FeedNode>(STORE_NODES, feedNodeId(type, key.trim()))
  return Boolean(n && n.kind === "feed" && isLive(n)) // 删除标记 / 非 feed 视为未关注
}

/** 读取单条关注 (映射); 删除标记 / 非 feed kind 视为不存在。供关注查看器自取数 (按 feed 节点 id)。 */
export async function getSubscription(id: string): Promise<Subscription | undefined> {
  const n = await idbGet<FeedNode>(STORE_NODES, id)
  if (!n || n.kind !== "feed" || !isLive(n)) return undefined
  return feedNodeToSub(n)
}

// ---- 写 ----

/** 关注; 活跃项已存在则原样返回 (幂等); 命中删除标记则恢复 (清除 deletedAt + 新 updatedAt, 保留原 createdAt)。 */
export async function addSubscription(input: NewSubscription): Promise<Subscription> {
  const key = input.key.trim()
  const id = feedNodeId(input.type, key)
  const existing = await idbGet<FeedNode>(STORE_NODES, id)
  if (existing && existing.kind === "feed" && isLive(existing)) return feedNodeToSub(existing) // 活跃 → 幂等
  // tool 关注的 key 即启动 URL, 会渲染成 <a href>; 全写入路径 (嵌入桥 / agent / 手动) 的最后一道安全校验:
  // 拒非 http(s) 协议, 防伪协议 (javascript:/data:) 入库后被点击触发存储型 XSS。
  if (input.type === "tool" && !safeHref(key)) {
    throw new Error("工具链接必须是 http(s) 地址")
  }
  const now = Date.now()
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
    // 恢复被软删的记录时保留原 createdAt (概念上同一关注又回来了); 全新关注则取 now。
    createdAt: existing?.createdAt ?? now,
    updatedAt: existing ? nextUpdatedAt(existing.updatedAt, now) : now,
  }
  // sub 无 deletedAt → subToFeedNode 不写删除标记位 = 恢复; 复用删除标记 sortKey, 全新则追加。
  const node = subToFeedNode(sub, existing?.sortKey || nextKey(maxKey(await allFeedNodes())))
  await idbPut(STORE_NODES, node)
  notifyFilesUpdated({ kind: "feed", id, subType: input.type })
  return sub
}

/**
 * 取消关注 —— 软删除: 写删除标记 (deletedAt) 而非物理删, 并 bump updatedAt 使其按 LWW 胜过对端旧副本,
 * 从而让删除跨端收敛。未关注 / 已是删除标记则幂等无操作。
 */
export async function removeSubscription(type: SubscriptionType, key: string): Promise<void> {
  const id = feedNodeId(type, key.trim())
  const existing = await idbGet<FeedNode>(STORE_NODES, id)
  if (!existing || existing.kind !== "feed" || !isLive(existing)) return // 未关注 / 已删除标记 → 幂等
  const now = Date.now()
  await captureTrashSnapshot(existing)
  await idbPut(STORE_NODES, {
    ...existing,
    deletedAt: now,
    updatedAt: nextUpdatedAt(existing.updatedAt, now),
  })
  notifyFilesUpdated({ kind: "feed", id, subType: type })
}

/**
 * 跨端同步落地 (sync 插件经 StorageSyncPort 调用): subs 是合并 + GC 后的完整数据 (含未过期删除标记, wire id=type:key)。
 * 映射回 feed 节点整批 put; 并物理删除「落地时刻 nodes 库中仍残留的过期 feed 删除标记」(据当前真实库, 仅限 feed kind)。
 */
export async function bulkPutSubscriptions(subs: Subscription[]): Promise<void> {
  const existing = await allFeedNodes() // feed 作用域: 过期删除标记 GC 绝不波及其它 kind 节点
  const keyById = new Map(existing.map((n) => [n.id, n.sortKey]))
  let lastKey = maxKey(existing)
  const nodes = subs.map((sub) => {
    const nid = feedNodeId(sub.type, sub.key)
    let sk = keyById.get(nid)
    if (!sk) {
      sk = nextKey(lastKey) // 新关注 → 追加键; 已存在 → 复用其 sortKey (不重排)
      lastKey = sk
    }
    return subToFeedNode(sub, sk)
  })
  const expired = expiredTombstoneIdsToDelete(existing, new Set(nodes.map((n) => n.id)), Date.now())
  if (nodes.length || expired.length) {
    // 写回合并后的完整数据 + 物理删过期删除标记同事务原子 (避免「已写回但删除标记未清」中间态)。
    await idbBulkPutDelete(STORE_NODES, nodes, expired)
    const types = new Set(subs.map((sub) => sub.type))
    notifyFilesUpdated({
      kind: "feed",
      ...(types.size === 1 ? { subType: [...types][0] } : {}),
    })
  }
}
