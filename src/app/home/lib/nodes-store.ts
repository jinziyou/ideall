// 统一 Node 库的跨 kind 只读读取层 —— 供侧栏「一切皆文件」文件树 / places 导航。
// 各 kind 的物理迁移仍归各自 *-store 的懒迁移 (seedXxxOnce); 此处只做协调触发 + 跨 kind 汇总读。
// 写路径仍走各 kind 专属 store (notes-store/bookmarks-store/...), 此处不重复写逻辑。
import type { NodeKind } from "@protocol/node"
import { idbGetAll, STORE_NODES } from "@/components/lib/idb"
import { buildParentOf, effectiveParentId, type TreeItem } from "./notes-tree-util"
import { seedNodesOnce } from "./notes-store"
import { seedBookmarksOnce } from "./bookmarks-store"
import { seedFilesOnce } from "./files-store"
import { seedFeedsOnce } from "./subscriptions-store"
import { seedThreadsOnce } from "./threads-store"

/** 跨 kind 节点摘要 (侧栏文件树用): TreeItem + kind + 是否有活跃子节点。 */
export interface NodeSummary extends TreeItem {
  kind: NodeKind
  hasChildren: boolean
}

/** kind → 触发其物理迁移的 seed once (folder 与 bookmark 同属书签迁移)。 */
const SEED_OF_KIND: Partial<Record<NodeKind, () => Promise<void>>> = {
  note: seedNodesOnce,
  bookmark: seedBookmarksOnce,
  folder: seedBookmarksOnce,
  file: seedFilesOnce,
  feed: seedFeedsOnce,
  thread: seedThreadsOnce,
}

/** 触发所请求 kind 的懒迁移 (确保旧仓库已播种进 STORE_NODES, 否则直读 STORE_NODES 会漏旧数据)。 */
async function ensureSeeded(kinds: NodeKind[]): Promise<void> {
  const seeds = new Set<() => Promise<void>>()
  for (const k of kinds) {
    const fn = SEED_OF_KIND[k]
    if (fn) seeds.add(fn)
  }
  await Promise.all([...seeds].map((fn) => fn()))
}

type RawNode = {
  id: string
  kind?: NodeKind
  title?: string
  parentId?: string | null
  sortKey?: string
  deletedAt?: number
}

/**
 * 列出指定 kind 的活跃节点摘要 (过滤墓碑)。供侧栏跨 kind 文件树 / places 导航。
 * hasChildren 仅在所请求 kinds 集合内计算 (跨 place 的父子不串台)。
 */
export async function listNodeSummaries(kinds: NodeKind[]): Promise<NodeSummary[]> {
  if (kinds.length === 0) return []
  await ensureSeeded(kinds)
  const want = new Set(kinds)
  const all = await idbGetAll<RawNode>(STORE_NODES)
  const live = all.filter((n) => n.kind != null && want.has(n.kind) && n.deletedAt == null)
  // hasChildren: 同集合内按 effectiveParentId 聚合 (复用笔记树同一不变量: 环/孤儿归根)。
  const flat = live.map((n) => ({ id: n.id, parentId: n.parentId ?? null }))
  const parentOf = buildParentOf(flat)
  const withChildren = new Set<string>()
  for (const n of flat) {
    const ep = effectiveParentId(n.id, n.parentId, parentOf)
    if (ep != null) withChildren.add(ep)
  }
  return live.map((n) => ({
    id: n.id,
    kind: n.kind as NodeKind,
    title: n.title ?? "",
    parentId: n.parentId ?? null,
    sortKey: n.sortKey ?? "",
    hasChildren: withChildren.has(n.id),
  }))
}
