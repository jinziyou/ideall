// 统一 Node 库的跨 kind 只读读取层 —— 供侧栏「一切皆文件」文件树 / places 导航。
// 各 kind 的物理迁移仍归各自 *-store 的懒迁移 (seedXxxOnce); 此处只做协调触发 + 跨 kind 汇总读。
// 写路径仍走各 kind 专属 store (notes-store/bookmarks-store/...), 此处不重复写逻辑。
import type { Node, NodeKind, FsCreateInput, FsWritePatch } from "@protocol/node"
import { NODE_KINDS } from "@protocol/node"
import type { SubscriptionType } from "@protocol/subscription"
import { safeHref } from "@/lib/safe-url"
import { idbGet, idbGetAll, STORE_NODES } from "@/lib/idb"
import { buildParentOf, effectiveParentId, type TreeItem } from "@/files/notes-tree-util"
import {
  seedNodesOnce,
  addNote,
  updateNote,
  moveNote,
  deleteNote,
} from "@/files/stores/notes-store"
import {
  seedBookmarksOnce,
  addBookmark,
  updateBookmark,
  deleteBookmark,
  addFolder,
  renameFolder,
  deleteFolder,
} from "@/files/stores/bookmarks-store"
import { seedFilesOnce, updateFileMeta, deleteFile, getFile } from "@/files/stores/files-store"
import {
  seedFeedsOnce,
  addSubscription,
  removeSubscription,
  getSubscription,
} from "@/files/stores/subscriptions-store"
import { seedThreadsOnce, deleteThread, renameThread } from "@/files/stores/threads-store"
import { feedNodeId } from "@/files/migrate/nodes-migrate"

/** 跨 kind 节点摘要 (侧栏文件树用): TreeItem + kind + 是否有活跃子节点。 */
export interface NodeSummary extends TreeItem {
  kind: NodeKind
  hasChildren: boolean
}

/** 全部本地 node kind (fs.read 不知 kind 时触发全部 seed; fs.list kind 缺省时遍历全部)。 */
export const ALL_NODE_KINDS: NodeKind[] = [...NODE_KINDS]

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

// ---- AI fs.* 文件面的底层读 (§6); 隐私净化 stripNode 在 @protocol/node (纯函数, 跨层共用) ----

/** 列出指定 kind 的活跃完整节点 (供 fs.list / fs://nodes; 调用方按需 stripNode 净化)。 */
export async function listNodesRaw(kinds: NodeKind[]): Promise<Node[]> {
  if (kinds.length === 0) return []
  await ensureSeeded(kinds)
  const want = new Set(kinds)
  const all = await idbGetAll<Node>(STORE_NODES)
  return all.filter((n) => n.kind != null && want.has(n.kind) && n.deletedAt == null)
}

/** 取单个活跃完整节点 (供 fs.read; 调用方按 kind 二次 gate / 净化)。kind 未知故触发全部 seed。 */
export async function getNodeRaw(id: string): Promise<Node | undefined> {
  await ensureSeeded(ALL_NODE_KINDS)
  const n = await idbGet<Node>(STORE_NODES, id)
  if (!n || n.deletedAt != null) return undefined
  return n
}

// ---- AI fs.* 写 (§6.1): 跨 kind 写按 kind 分派到各 kind 专属 store, 回读为 Node。 ----
// content 用各 kind 的 Node content 形态 (note=Plate Value 数组; bookmark={url,description,favicon};
// feed={type,key,...}; thread/folder/file 不经 fs.create)。写后用 getNodeRaw 回读统一 Node。

/** fs.create: 按 kind 新建节点, 回读为 Node。file 不可经此创建 (需二进制上传)。 */
export async function createNode(input: FsCreateInput): Promise<Node> {
  let id: string
  switch (input.kind) {
    case "note": {
      const n = await addNote({
        title: input.title,
        content: Array.isArray(input.content) ? (input.content as unknown[]) : undefined,
        parentId: input.parentId ?? null,
        tags: input.tags,
      })
      id = n.id
      break
    }
    case "folder": {
      id = (await addFolder(input.title ?? "")).id
      break
    }
    case "bookmark": {
      const c = (input.content ?? {}) as { url?: string; description?: string; favicon?: string }
      if (typeof c.url !== "string" || !safeHref(c.url))
        throw new Error("bookmark 需合法 http(s) url")
      const b = await addBookmark({
        url: c.url,
        title: input.title || c.url,
        description: c.description,
        favicon: c.favicon,
        folderId: input.parentId ?? null,
        tags: input.tags,
      })
      id = b.id
      break
    }
    case "feed": {
      const c = (input.content ?? {}) as {
        type?: SubscriptionType
        key?: string
        favicon?: string
        entityLabel?: string
        entityName?: string
        searchKeyword?: string
        searchDomain?: string
      }
      if (!c.type || typeof c.key !== "string" || !c.key) throw new Error("feed 需 type + key")
      await addSubscription({
        type: c.type,
        key: c.key,
        title: input.title || c.key,
        favicon: c.favicon,
        entityLabel: c.entityLabel,
        entityName: c.entityName,
        searchKeyword: c.searchKeyword,
        searchDomain: c.searchDomain,
      })
      id = feedNodeId(c.type, c.key.trim())
      break
    }
    case "thread":
      throw new Error("thread 由 AI 会话自动创建, 不经 fs.create")
    case "file":
      throw new Error("file 不可经 fs.create 创建 (需二进制上传)")
    default:
      throw new Error(`未知 kind: ${input.kind}`)
  }
  const n = await getNodeRaw(id)
  if (!n) throw new Error("创建后回读失败")
  return n
}

/** fs.write: 按 kind 改节点 (只改给定字段), 回读为 Node; 不存在 → undefined。 */
export async function updateNode(
  kind: NodeKind,
  id: string,
  patch: FsWritePatch,
): Promise<Node | undefined> {
  switch (kind) {
    case "note":
      await updateNote(id, {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
        ...(Array.isArray(patch.content) ? { content: patch.content as unknown[] } : {}),
        ...(patch.parentId !== undefined ? { parentId: patch.parentId } : {}),
      })
      break
    case "bookmark": {
      const c = (patch.content ?? {}) as { url?: string; description?: string; favicon?: string }
      await updateBookmark(id, {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
        ...(typeof c.url === "string" ? { url: c.url } : {}),
        ...(typeof c.description === "string" ? { description: c.description } : {}),
        ...(typeof c.favicon === "string" ? { favicon: c.favicon } : {}),
        ...(patch.parentId !== undefined ? { folderId: patch.parentId } : {}),
      })
      break
    }
    case "folder":
      if (patch.title !== undefined) await renameFolder(id, patch.title)
      break
    case "file":
      await updateFileMeta(id, {
        ...(patch.title !== undefined ? { name: patch.title } : {}),
        ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
      })
      break
    case "thread":
      if (patch.title !== undefined) await renameThread(id, patch.title)
      break
    default:
      return undefined // feed 无字段级更新 (关注由 add/remove 管理)
  }
  return getNodeRaw(id)
}

/** fs.move: 改父 + 同级位置 (仅 note 树 / bookmark 归夹有意义; 余无操作)。 */
export async function moveNode(
  kind: NodeKind,
  id: string,
  parentId: string | null,
  afterSortKey?: string | null,
): Promise<Node | undefined> {
  if (kind === "note") {
    await moveNote(id, parentId, afterSortKey === undefined ? undefined : { afterSortKey })
  } else if (kind === "bookmark") {
    await updateBookmark(id, { folderId: parentId })
  }
  return getNodeRaw(id)
}

/** fs.delete: 按 kind 删 (note/bookmark/folder/file 软删墓碑; feed 取消关注墓碑; thread 硬删)。 */
export async function deleteNode(kind: NodeKind, id: string): Promise<void> {
  switch (kind) {
    case "note":
      await deleteNote(id)
      break
    case "bookmark":
      await deleteBookmark(id)
      break
    case "folder":
      await deleteFolder(id)
      break
    case "file":
      await deleteFile(id)
      break
    case "thread":
      await deleteThread(id)
      break
    case "feed": {
      const sub = await getSubscription(id)
      if (sub) await removeSubscription(sub.type, sub.key)
      break
    }
  }
}

/** fs.readBlob: 读文件二进制为 base64 (含 mime/size)。大文件拒读防 token 爆炸。 */
const BLOB_READ_CAP = 1024 * 1024 // 1MB
export async function readBlobBase64(
  id: string,
): Promise<{ mime: string; size: number; base64: string } | undefined> {
  await seedFilesOnce()
  const f = await getFile(id)
  if (!f) return undefined
  if (f.size > BLOB_READ_CAP) {
    return { mime: f.type, size: f.size, base64: "" } // 过大不内联, 仅回元数据
  }
  const buf = await f.blob.arrayBuffer()
  let binary = ""
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return { mime: f.type, size: f.size, base64: btoa(binary) }
}
