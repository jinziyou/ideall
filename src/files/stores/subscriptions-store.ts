// 「发现」关注本地存储仓库 —— 折叠步 C 后物理统一到 nodes 仓库 (kind:"feed", 确定性 id feed:type:key)。
// 对外仍以 Subscription 域类型呈现 (节点↔Subscription 映射在本仓库边界), 消费方零改;
// 同步仍走 "subs" scope, 但原始全量/bulk 能力已独立收口到 StorageSyncPort,
// 本仓库把 feed 节点映射回旧 Subscription wire (id 由 content.type:key 重建 = 旧确定性 id, 跨端 LWW 一致)。
// 删除走软删标记 (deletedAt), 含删除标记全量参与同步合并 (漏带 = 已删关注被对端恢复)。
import {
  hasCanonicalSubscriptionIdentity,
  hasValidSubscriptionMetadata,
  isSubscriptionType,
  type Subscription,
  type SubscriptionType,
  type NewSubscription,
} from "@protocol/subscription"
import type { Node, NodeKind, NodeOfKind } from "@protocol/node"
import {
  isLive,
  expiredTombstoneIdsToDelete,
  recordsEqual,
  isSaneSyncTimestamp,
} from "@protocol/sync"
import { StorageSyncConflictError } from "@protocol/storage-sync"
import { faviconForDomain, faviconForUrl } from "@/lib/favicon"
import { safeHref } from "@/lib/safe-url"
import { assertValidSortKey, maxSortKey, sortKeyBetween } from "@/files/sort-key"
import { feedNodeId, subToFeedNode, feedNodeToSub } from "@/files/feed-node"
import {
  idbGet,
  idbGetAllFromIndex,
  idbRunTransaction,
  INDEX_NODES_KIND,
  STORE_NODES,
  STORE_TRASH_SNAPSHOTS,
} from "@/lib/idb"
import { notifyFilesUpdated } from "@protocol/flowback"
import type { TrashSnapshot } from "@/files/stores/trash-store"
import { addNodeAtKindTail } from "@/files/stores/node-tail-transaction"
import {
  assertNodeMutationExpectation,
  type NodeMutationExpectation,
} from "@/files/stores/node-mutation"
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
export async function addSubscriptionWithNode(input: NewSubscription): Promise<FeedNode> {
  const key = input.key.trim()
  if (!isSubscriptionType(input.type)) throw new Error("关注类型无效")
  if (!key) throw new Error("关注 key 不能为空")
  const id = feedNodeId(input.type, key)
  // tool 关注的 key 即启动 URL, 会渲染成 <a href>; 全写入路径 (嵌入桥 / agent / 手动) 的最后一道安全校验:
  // 拒非 http(s) 协议, 防伪协议 (javascript:/data:) 入库后被点击触发存储型 XSS。
  if (input.type === "tool" && !safeHref(key)) {
    throw new Error("工具链接必须是 http(s) 地址")
  }
  const now = Date.now()
  const outcome = await idbRunTransaction<{ node: FeedNode; changed: boolean }>(
    [STORE_NODES, STORE_TRASH_SNAPSHOTS],
    "readwrite",
    (transaction, setResult, abort) => {
      const store = transaction.objectStore(STORE_NODES)
      const trashStore = transaction.objectStore(STORE_TRASH_SNAPSHOTS)
      const request = store.get(id)
      request.onerror = () => abort(request.error ?? new Error("读取关注状态失败"))
      request.onsuccess = () => {
        try {
          const existing = request.result as Node | undefined
          if (existing && existing.kind !== "feed") {
            throw new Error("关注 id 已被其它节点占用")
          }
          if (existing && isLive(existing)) {
            trashStore.delete(id)
            setResult({ node: existing, changed: false })
            return
          }
          const subscription: Subscription = {
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
            // 恢复被软删的记录时保留原 createdAt；全新关注取当前时间。
            createdAt: existing?.createdAt ?? now,
            updatedAt: existing ? nextUpdatedAt(existing.updatedAt, now) : now,
          }
          if (existing) {
            if (!existing.sortKey) throw new Error("待恢复关注缺少有效 sortKey")
            const node = subToFeedNode(subscription, existing.sortKey)
            store.put(node)
            trashStore.delete(id)
            setResult({ node, changed: true })
            return
          }
          trashStore.delete(id)
          addNodeAtKindTail(
            store,
            { kind: "feed", parentId: null },
            (sortKey) => subToFeedNode(subscription, sortKey),
            (node) => setResult({ node, changed: true }),
            abort,
          )
        } catch (error) {
          abort(error)
        }
      }
    },
  )
  if (outcome.changed) notifyFilesUpdated({ kind: "feed", id, subType: input.type })
  return outcome.node
}

/** 兼容既有 FilesPort DTO；创建真相由 addSubscriptionWithNode 返回。 */
export async function addSubscription(input: NewSubscription): Promise<Subscription> {
  return feedNodeToSub(await addSubscriptionWithNode(input))
}

/**
 * 取消关注 —— 软删除: 写删除标记 (deletedAt) 而非物理删, 并 bump updatedAt 使其按 LWW 胜过对端旧副本,
 * 从而让删除跨端收敛。未关注 / 已是删除标记则幂等无操作。
 */
export async function removeSubscription(
  type: SubscriptionType,
  key: string,
  expected?: NodeMutationExpectation,
): Promise<boolean> {
  const id = feedNodeId(type, key.trim())
  const removed = await idbRunTransaction<boolean>(
    [STORE_NODES, STORE_TRASH_SNAPSHOTS],
    "readwrite",
    (transaction, setResult, abort) => {
      const nodeStore = transaction.objectStore(STORE_NODES)
      const trashStore = transaction.objectStore(STORE_TRASH_SNAPSHOTS)
      const request = nodeStore.get(id)
      request.onerror = () => abort(request.error ?? new Error("读取待取消关注失败"))
      request.onsuccess = () => {
        try {
          const existing = request.result as Node | undefined
          assertNodeMutationExpectation(existing, expected)
          if (!existing || existing.kind !== "feed" || !isLive(existing)) {
            setResult(false)
            return
          }
          const now = Date.now()
          trashStore.put({
            id: existing.id,
            node: existing,
            capturedAt: now,
          } satisfies TrashSnapshot)
          nodeStore.put({
            ...existing,
            deletedAt: now,
            updatedAt: nextUpdatedAt(existing.updatedAt, now),
          } satisfies FeedNode)
          setResult(true)
        } catch (error) {
          abort(error)
        }
      }
    },
  )
  if (removed) notifyFilesUpdated({ kind: "feed", id, subType: type })
  return removed
}

/**
 * 跨端同步落地 (sync 插件经 StorageSyncPort 调用): subs 是合并 + GC 后的完整数据 (含未过期删除标记, wire id=type:key)。
 * 映射回 feed 节点整批 put; 并物理删除「落地时刻 nodes 库中仍残留的过期 feed 删除标记」(据当前真实库, 仅限 feed kind)。
 */
export async function bulkPutSubscriptions(
  subs: Subscription[],
  expectedLocal: Subscription[],
): Promise<Subscription[]> {
  const outcome = await idbRunTransaction<{ items: Subscription[]; changed: boolean }>(
    [STORE_NODES, STORE_TRASH_SNAPSHOTS],
    "readwrite",
    (transaction, setResult, abort) => {
      const store = transaction.objectStore(STORE_NODES)
      const trashStore = transaction.objectStore(STORE_TRASH_SNAPSHOTS)
      // 同步合并本来就需要完整 feed 值；关键是把读取、键分配、写回与 GC 收进同一写事务，
      // 避免本地 addSubscription 夹在两次事务之间造成重复 sortKey。
      const request = store.index(INDEX_NODES_KIND).getAll("feed")
      request.onerror = () => abort(request.error ?? new Error("读取关注同步快照失败"))
      request.onsuccess = () => {
        try {
          const existing = (request.result as Node[]).filter(
            (node): node is FeedNode => node.kind === "feed",
          )
          for (const node of existing) {
            const { type, key } = node.content
            if (
              !isSubscriptionType(type) ||
              typeof key !== "string" ||
              key.length === 0 ||
              key.trim() !== key ||
              node.id !== feedNodeId(type, key) ||
              (type === "tool" && !safeHref(key))
            ) {
              throw new Error(`关注节点包含非规范身份: ${node.id}`)
            }
            assertValidSortKey(node.sortKey)
          }
          const actual = existing.map(feedNodeToSub)
          const validationNow = Date.now()
          for (const sub of subs) {
            if (!isSubscriptionType(sub.type)) {
              throw new Error(`关注同步批次包含非法类型: ${String(sub.type)}`)
            }
            if (!hasCanonicalSubscriptionIdentity(sub)) {
              throw new Error(`关注同步批次包含非规范主键: ${sub.id}`)
            }
            if (sub.type === "tool" && !safeHref(sub.key)) {
              throw new Error("工具链接必须是 http(s) 地址")
            }
            if (
              typeof sub.title !== "string" ||
              typeof sub.favicon !== "string" ||
              !hasValidSubscriptionMetadata(sub) ||
              !isSaneSyncTimestamp(sub.createdAt, validationNow) ||
              !isSaneSyncTimestamp(sub.updatedAt, validationNow) ||
              (sub.deletedAt !== undefined && !isSaneSyncTimestamp(sub.deletedAt, validationNow))
            ) {
              throw new Error(`关注同步批次包含非法字段: ${sub.id}`)
            }
          }
          const desired = subs.map((sub) => feedNodeToSub(subToFeedNode(sub, "sync-cas")))
          if (recordsEqual(actual, desired)) {
            for (const sub of desired) {
              if (isLive(sub)) trashStore.delete(feedNodeId(sub.type, sub.key))
            }
            setResult({ items: actual, changed: false })
            return
          }
          if (!recordsEqual(actual, expectedLocal)) {
            throw new StorageSyncConflictError("关注")
          }
          const keyById = new Map(existing.map((node) => [node.id, node.sortKey]))
          const existingById = new Map(existing.map((node) => [node.id, node]))
          const batchIds = new Set<string>()
          let lastKey = maxSortKey(existing)
          const writes = subs.map((sub) => {
            const nodeId = feedNodeId(sub.type, sub.key)
            if (batchIds.has(nodeId)) throw new Error(`关注同步批次包含重复 id: ${nodeId}`)
            batchIds.add(nodeId)
            const exists = keyById.has(nodeId)
            let sortKey = keyById.get(nodeId)
            if (!sortKey) {
              sortKey = sortKeyBetween(lastKey, null)
              lastKey = sortKey
            }
            return { node: subToFeedNode(sub, sortKey), exists }
          })
          const nodes = writes.map(({ node }) => node)
          const expired = expiredTombstoneIdsToDelete(
            existing,
            new Set(nodes.map((node) => node.id)),
            Date.now(),
          )
          // 仅已存在的 feed 可 put；全新 id 使用 add，使同主键非 feed 节点触发
          // ConstraintError 并回滚整批，而不是被外部同步数据静默覆盖。
          for (const { node, exists } of writes) {
            const current = existingById.get(node.id)
            if (isLive(node)) {
              trashStore.delete(node.id)
            } else if (current && isLive(current)) {
              trashStore.put({
                id: current.id,
                node: current,
                capturedAt: Date.now(),
              } satisfies TrashSnapshot)
            }
            if (exists) store.put(node)
            else store.add(node)
          }
          for (const id of expired) {
            store.delete(id)
            trashStore.delete(id)
          }
          setResult({
            items: nodes.map(feedNodeToSub),
            changed: true,
          })
        } catch (error) {
          abort(error)
        }
      }
    },
  )
  if (outcome.changed) {
    const types = new Set(outcome.items.map((sub) => sub.type))
    notifyFilesUpdated({
      kind: "feed",
      ...(types.size === 1 ? { subType: [...types][0] } : {}),
    })
  }
  return outcome.items
}
