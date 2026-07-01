// feed 节点 ↔ Subscription 的运行期映射助手 (唯一数据来源: subscriptions-store 与 nodes-store 共用,
// 防双处映射漂移)。feed 节点用确定性 id, 还原时由 content.type:key 重建跨端同步 wire id。
import type { Subscription } from "@protocol/subscription"
import type { NodeOfKind } from "@protocol/node"

type FeedNode = NodeOfKind<"feed">

/** 确定性 feed 节点 id: feed:type:key (绝不 genId; 两端独立创建同关注得同 id → 跨端零 churn)。 */
export function feedNodeId(type: string, key: string): string {
  return `feed:${type}:${key}`
}

/** Subscription → feed 节点。sortKey 由调用方算 (追加键)。删除标记 deletedAt 原样带过。 */
export function subToFeedNode(sub: Subscription, sortKey: string): FeedNode {
  const content: FeedNode["content"] = {
    type: sub.type,
    key: sub.key,
    favicon: sub.favicon ?? "",
  }
  if (sub.entityLabel !== undefined) content.entityLabel = sub.entityLabel
  if (sub.entityName !== undefined) content.entityName = sub.entityName
  if (sub.searchKeyword !== undefined) content.searchKeyword = sub.searchKeyword
  if (sub.searchDomain !== undefined) content.searchDomain = sub.searchDomain
  const node: FeedNode = {
    id: feedNodeId(sub.type, sub.key),
    kind: "feed",
    title: sub.title,
    parentId: null,
    sortKey,
    tags: [],
    createdAt: sub.createdAt,
    updatedAt: sub.updatedAt ?? sub.createdAt,
    content,
  }
  if (sub.deletedAt !== undefined) node.deletedAt = sub.deletedAt
  return node
}

/** feed 节点 → Subscription (还原)。wire id 由 content.type:key 重建 = 确定性 id, 供跨端同步合并。 */
export function feedNodeToSub(n: FeedNode): Subscription {
  const c = n.content
  const sub: Subscription = {
    id: `${c.type}:${c.key}`,
    type: c.type,
    key: c.key,
    title: n.title,
    favicon: c.favicon,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
  }
  if (c.entityLabel !== undefined) sub.entityLabel = c.entityLabel
  if (c.entityName !== undefined) sub.entityName = c.entityName
  if (c.searchKeyword !== undefined) sub.searchKeyword = c.searchKeyword
  if (c.searchDomain !== undefined) sub.searchDomain = c.searchDomain
  if (n.deletedAt !== undefined) sub.deletedAt = n.deletedAt
  return sub
}
