// 链接收藏本地存储仓库 —— 折叠步 B 后物理统一到 nodes 仓库 (kind:"bookmark"/"folder")。
// 对外仍以 Bookmark / BookmarkFolder 域类型呈现 (节点↔域类型投影在本仓库边界完成), 消费方零改:
//   - 书签节点: folderId→parentId, url/description/favicon 收进 content, title/tags 留顶层;
//   - 收藏夹节点: name→title, 根级 (parentId=null);
//   - 删除走软删墓碑 (deletedAt, 与笔记/订阅一致), 读路径过滤墓碑 —— 当前用于撤销跨刷新稳健, 并为后续同步就绪。
// 本切片不开同步 (维持现状未同步); sortKey/updatedAt 已补齐, 墓碑 GC 随 bookmark-sync 落地 (与笔记同纪律)。
import { Bookmark, BookmarkFolder } from "../model"
import type { NodeKind, NodeOfKind } from "@protocol/node"
import { genId } from "@/components/lib/id"
import { isLive } from "@protocol/sync"
import { sortKeyBetween } from "./sort-key"
import { planBookmarksSeed } from "./nodes-migrate"
import {
  idbBulkDelete,
  idbBulkPut,
  idbGetAll,
  idbPut,
  idbReadModifyWrite,
  STORE_BOOKMARKS,
  STORE_FOLDERS,
  STORE_NODES,
} from "@/components/lib/idb"
import { notifyHubUpdated } from "./flowback"

type BookmarkNode = NodeOfKind<"bookmark">
type FolderNode = NodeOfKind<"folder">

/** 从 URL 推断 favicon (Google s2 服务), 失败时图标位降级为占位 */
export function faviconFor(url: string): string {
  try {
    const host = new URL(url).hostname
    return `https://www.google.com/s2/favicons?domain=${host}&sz=64`
  } catch {
    return ""
  }
}

// ---- 节点 ↔ 域类型投影 ----

function nodeToBookmark(n: BookmarkNode): Bookmark {
  return {
    id: n.id,
    title: n.title,
    url: n.content.url,
    description: n.content.description,
    favicon: n.content.favicon,
    folderId: n.parentId,
    tags: n.tags,
    createdAt: n.createdAt,
  }
}

function nodeToFolder(n: FolderNode): BookmarkFolder {
  return { id: n.id, name: n.title, createdAt: n.createdAt }
}

function bookmarkToNode(b: Bookmark, sortKey: string, updatedAt: number): BookmarkNode {
  return {
    id: b.id,
    kind: "bookmark",
    title: b.title,
    parentId: b.folderId,
    sortKey,
    tags: b.tags,
    createdAt: b.createdAt,
    updatedAt,
    content: { url: b.url, description: b.description, favicon: b.favicon },
  }
}

// ---- 懒迁移: 折叠步 B —— 书签/收藏夹播种进 nodes 仓库 ----

let seedPromise: Promise<void> | null = null

/**
 * 折叠步 B 懒迁移 (模块级 once): 把旧 bookmarks/bookmarkFolders 仓库播种进 STORE_NODES 并清空旧仓库。
 * 每个读写入口先 await。失败不缓存 (置回 null) 可重试。不放 onupgradeneeded 内 (同笔记迁移理由)。
 */
export function seedBookmarksOnce(): Promise<void> {
  if (!seedPromise) {
    seedPromise = doSeedBookmarks().catch((e) => {
      seedPromise = null
      throw e
    })
  }
  return seedPromise
}

async function doSeedBookmarks(): Promise<void> {
  const [rawBookmarks, rawFolders, existingNodes] = await Promise.all([
    idbGetAll<Record<string, unknown>>(STORE_BOOKMARKS),
    idbGetAll<Record<string, unknown>>(STORE_FOLDERS),
    idbGetAll<{ id: string }>(STORE_NODES),
  ])
  const plan = planBookmarksSeed(
    rawBookmarks,
    rawFolders,
    new Set(existingNodes.map((n) => n.id)),
    Date.now(),
  )
  if (!plan) return // 旧仓库已空 (无存量 / 已播种清空)
  // 先写 nodes 再清空旧仓库; 顺序 put→delete 不丢数据, existingNodeIds 探测保证幂等。
  if (plan.puts.length) await idbBulkPut(STORE_NODES, plan.puts)
  if (plan.drainBookmarkIds.length) await idbBulkDelete(STORE_BOOKMARKS, plan.drainBookmarkIds)
  if (plan.drainFolderIds.length) await idbBulkDelete(STORE_FOLDERS, plan.drainFolderIds)
}

// ---- nodes 仓库内 kind 作用域读 + sortKey 追加 ----

async function allBookmarkNodes(): Promise<BookmarkNode[]> {
  const all = await idbGetAll<{ id: string; kind?: NodeKind }>(STORE_NODES)
  return all.filter((n): n is BookmarkNode => n.kind === "bookmark")
}

async function allFolderNodes(): Promise<FolderNode[]> {
  const all = await idbGetAll<{ id: string; kind?: NodeKind }>(STORE_NODES)
  return all.filter((n): n is FolderNode => n.kind === "folder")
}

/** 同级最大 sortKey (含墓碑, 避免复用墓碑键区)。 */
function maxKey(nodes: { sortKey: string }[]): string | null {
  const keys = nodes
    .map((n) => n.sortKey)
    .filter((k) => typeof k === "string" && k.length > 0)
    .sort()
  return keys.length ? keys[keys.length - 1] : null
}

/** 自 after 起生成 count 个严格递增键 (全局单调即天然组内唯一; 书签列表按 createdAt 展示, sortKey 仅供就绪)。 */
function nextKeys(after: string | null, count: number): string[] {
  const out: string[] = []
  let prev = after
  for (let i = 0; i < count; i++) {
    let k: string
    try {
      k = sortKeyBetween(prev, null)
    } catch {
      k = sortKeyBetween(null, null)
    }
    out.push(k)
    prev = k
  }
  return out
}

// ---- 收藏夹 ----

export async function listFolders(): Promise<BookmarkFolder[]> {
  await seedBookmarksOnce()
  const folders = (await allFolderNodes()).filter(isLive).map(nodeToFolder)
  return folders.sort((a, b) => a.createdAt - b.createdAt)
}

export async function addFolder(name: string): Promise<BookmarkFolder> {
  await seedBookmarksOnce()
  const existing = await allFolderNodes()
  const now = Date.now()
  const node: FolderNode = {
    id: genId("fld"),
    kind: "folder",
    title: name.trim() || "未命名收藏夹",
    parentId: null,
    sortKey: nextKeys(maxKey(existing), 1)[0],
    tags: [],
    createdAt: now,
    updatedAt: now,
    content: null,
  }
  await idbPut(STORE_NODES, node)
  return nodeToFolder(node)
}

export async function renameFolder(id: string, name: string): Promise<void> {
  await seedBookmarksOnce()
  await idbReadModifyWrite<FolderNode>(STORE_NODES, id, (current) =>
    current && current.kind === "folder"
      ? { ...current, title: name.trim() || current.title, updatedAt: Date.now() }
      : undefined,
  )
}

/** 删除收藏夹 (软删墓碑); 夹内活跃书签移动到未分组 (parentId = null)。 */
export async function deleteFolder(id: string): Promise<void> {
  await seedBookmarksOnce()
  const now = Date.now()
  const orphans = (await allBookmarkNodes())
    .filter(isLive)
    .filter((n) => n.parentId === id)
    .map((n) => ({ ...n, parentId: null, updatedAt: now }))
  if (orphans.length) await idbBulkPut(STORE_NODES, orphans)
  await idbReadModifyWrite<FolderNode>(STORE_NODES, id, (current) =>
    current && current.kind === "folder"
      ? { ...current, deletedAt: now, updatedAt: now }
      : undefined,
  )
}

// ---- 书签 ----

export async function listBookmarks(): Promise<Bookmark[]> {
  await seedBookmarksOnce()
  const items = (await allBookmarkNodes()).filter(isLive).map(nodeToBookmark)
  return items.sort((a, b) => b.createdAt - a.createdAt)
}

/** 活跃书签数 (过滤墓碑) —— 数量徽标用。 */
export async function countBookmarks(): Promise<number> {
  await seedBookmarksOnce()
  return (await allBookmarkNodes()).filter(isLive).length
}

export type NewBookmark = {
  title: string
  url: string
  description?: string
  favicon?: string
  folderId?: string | null
  tags?: string[]
}

export async function addBookmark(input: NewBookmark): Promise<Bookmark> {
  await seedBookmarksOnce()
  const existing = await allBookmarkNodes()
  const now = Date.now()
  const node: BookmarkNode = {
    id: genId("bm"),
    kind: "bookmark",
    title: input.title.trim() || input.url,
    parentId: input.folderId ?? null,
    sortKey: nextKeys(maxKey(existing), 1)[0],
    tags: input.tags ?? [],
    createdAt: now,
    updatedAt: now,
    content: {
      url: input.url.trim(),
      description: input.description?.trim() ?? "",
      favicon: input.favicon || faviconFor(input.url),
    },
  }
  await idbPut(STORE_NODES, node)
  notifyHubUpdated()
  return nodeToBookmark(node)
}

/** 批量导入 (浏览器书签导入用), 一次事务写入 */
export async function bulkAddBookmarks(inputs: NewBookmark[]): Promise<Bookmark[]> {
  await seedBookmarksOnce()
  const existing = await allBookmarkNodes()
  const now = Date.now()
  const keys = nextKeys(maxKey(existing), inputs.length)
  const nodes: BookmarkNode[] = inputs.map((input, i) => ({
    // 批量导入在同一毫秒内生成, 追加下标 i 保证批内 ID 一定互不相同 (genId 随机后缀无法杜绝同毫秒碰撞)。
    id: `${genId("bm")}_${i}`,
    kind: "bookmark",
    title: input.title.trim() || input.url,
    parentId: input.folderId ?? null,
    sortKey: keys[i],
    tags: input.tags ?? [],
    // 保持导入顺序, 后导入的略晚
    createdAt: now + i,
    updatedAt: now + i,
    content: {
      url: input.url.trim(),
      description: input.description?.trim() ?? "",
      favicon: input.favicon || faviconFor(input.url),
    },
  }))
  await idbBulkPut(STORE_NODES, nodes)
  notifyHubUpdated()
  return nodes.map(nodeToBookmark)
}

export async function updateBookmark(
  id: string,
  patch: Partial<Omit<Bookmark, "id" | "createdAt">>,
): Promise<void> {
  await seedBookmarksOnce()
  // 单事务读-改-写 + 按主键单取; kind 守卫防误改其它 kind 节点。
  await idbReadModifyWrite<BookmarkNode>(STORE_NODES, id, (current) => {
    if (!current || current.kind !== "bookmark") return undefined
    const content = { ...current.content }
    if (patch.url !== undefined) content.url = patch.url
    if (patch.description !== undefined) content.description = patch.description
    if (patch.favicon !== undefined) content.favicon = patch.favicon
    const next: BookmarkNode = { ...current, content, updatedAt: Date.now() }
    if (patch.title !== undefined) next.title = patch.title
    if (patch.tags !== undefined) next.tags = patch.tags
    if (patch.folderId !== undefined) next.parentId = patch.folderId
    return next
  })
  // 与 add/bulkAdd/delete 一致: 通知中枢回流, 否则 keep-alive 的概览时间线在改名后会陈旧。
  notifyHubUpdated()
}

/** 删除书签 (软删墓碑; 撤销靠 restoreBookmark 复活)。 */
export async function deleteBookmark(id: string): Promise<void> {
  await seedBookmarksOnce()
  const now = Date.now()
  await idbReadModifyWrite<BookmarkNode>(STORE_NODES, id, (current) =>
    current && current.kind === "bookmark"
      ? { ...current, deletedAt: now, updatedAt: now }
      : undefined,
  )
  notifyHubUpdated()
}

/** 撤销删除: 把刚删除的书签复活 (清墓碑 + bump updatedAt, 保留 id/createdAt/分组)。 */
export async function restoreBookmark(bookmark: Bookmark): Promise<void> {
  await seedBookmarksOnce()
  const now = Date.now()
  const existing = await allBookmarkNodes()
  const fallbackKey = nextKeys(maxKey(existing), 1)[0]
  await idbReadModifyWrite<BookmarkNode>(STORE_NODES, bookmark.id, (current) => {
    // 软删后墓碑节点仍在 → 复用其 sortKey 复活; 极端兜底 (节点不存在) 用追加键重建。
    const base =
      current && current.kind === "bookmark" ? current : bookmarkToNode(bookmark, fallbackKey, now)
    const revived: BookmarkNode = {
      ...base,
      title: bookmark.title,
      parentId: bookmark.folderId,
      tags: bookmark.tags,
      content: { url: bookmark.url, description: bookmark.description, favicon: bookmark.favicon },
      updatedAt: now,
    }
    delete revived.deletedAt
    return revived
  })
  notifyHubUpdated()
}
