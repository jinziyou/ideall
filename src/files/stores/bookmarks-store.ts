// 链接收藏本地存储仓库 —— 折叠步 B 后物理统一到 nodes 仓库 (kind:"bookmark"/"folder")。
// 对外仍以 Bookmark / BookmarkFolder 域类型呈现 (节点↔域类型映射在本仓库边界完成), 消费方零改:
//   - 书签节点: folderId→parentId, url/description/favicon 收进 content, title/tags 留顶层;
//   - 收藏夹节点: name→title, 根级 (parentId=null);
//   - 删除走软删标记 (deletedAt, 与笔记/关注一致), 读路径过滤删除标记 —— 当前用于撤销跨刷新稳健, 并为后续同步就绪。
// 本切片不开同步 (维持现状未同步); sortKey/updatedAt 已补齐, 删除标记 GC 随 bookmark-sync 落地 (与笔记同纪律)。
import { Bookmark, BookmarkFolder } from "@protocol/files"
import type { NodeKind, NodeOfKind } from "@protocol/node"
import { faviconForUrl } from "@/lib/favicon"
import { genId } from "@/lib/id"
import { isLive } from "@protocol/sync"
import { sortKeyBetween } from "@/files/sort-key"
import { computeSiblingSortKey, type InsertPos } from "@/files/notes-tree-util"
import {
  idbBulkPut,
  idbGet,
  idbGetAllFromIndex,
  idbPut,
  idbReadModifyWrite,
  INDEX_NODES_KIND,
  STORE_NODES,
} from "@/lib/idb"
import { notifyFilesUpdated } from "@protocol/flowback"
import { captureTrashSnapshot } from "@/files/stores/trash-store"

type BookmarkNode = NodeOfKind<"bookmark">
type FolderNode = NodeOfKind<"folder">

// ---- 节点 ↔ 域类型映射 ----

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

// ---- nodes 仓库内 kind 作用域读 + sortKey 追加 ----

async function allBookmarkNodes(): Promise<BookmarkNode[]> {
  const all = await idbGetAllFromIndex<{ id: string; kind?: NodeKind }>(
    STORE_NODES,
    INDEX_NODES_KIND,
    "bookmark",
  )
  return all.filter((n): n is BookmarkNode => n.kind === "bookmark")
}

async function allFolderNodes(): Promise<FolderNode[]> {
  const all = await idbGetAllFromIndex<{ id: string; kind?: NodeKind }>(
    STORE_NODES,
    INDEX_NODES_KIND,
    "folder",
  )
  return all.filter((n): n is FolderNode => n.kind === "folder")
}

/** 同级最大 sortKey (含删除标记, 避免复用删除标记键区)。 */
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
  const folders = (await allFolderNodes()).filter(isLive).map(nodeToFolder)
  return folders.sort((a, b) => a.createdAt - b.createdAt)
}

export async function addFolder(name: string): Promise<BookmarkFolder> {
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
  await idbReadModifyWrite<FolderNode>(STORE_NODES, id, (current) =>
    current && current.kind === "folder"
      ? { ...current, title: name.trim() || current.title, updatedAt: Date.now() }
      : undefined,
  )
}

/** 删除收藏夹 (软删标记); 夹内活跃书签移动到未分组 (parentId = null)。 */
export async function deleteFolder(id: string): Promise<void> {
  const now = Date.now()
  const folder = await idbGet<FolderNode>(STORE_NODES, id)
  if (folder && folder.kind === "folder" && isLive(folder)) await captureTrashSnapshot(folder)
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
  const items = (await allBookmarkNodes()).filter(isLive).map(nodeToBookmark)
  return items.sort((a, b) => b.createdAt - a.createdAt)
}

/** 活跃书签数 (过滤删除标记) —— 数量徽标用。 */
export async function countBookmarks(): Promise<number> {
  return (await allBookmarkNodes()).filter(isLive).length
}

/** 读取单条书签 (映射); 删除标记 / 非书签 kind 视为不存在。供书签查看器自取数。 */
export async function getBookmark(id: string): Promise<Bookmark | undefined> {
  const n = await idbGet<BookmarkNode>(STORE_NODES, id)
  if (!n || n.kind !== "bookmark" || !isLive(n)) return undefined
  return nodeToBookmark(n)
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
      favicon: input.favicon || faviconForUrl(input.url),
    },
  }
  await idbPut(STORE_NODES, node)
  notifyFilesUpdated()
  return nodeToBookmark(node)
}

/** 批量导入 (浏览器书签导入用), 一次事务写入 */
export async function bulkAddBookmarks(inputs: NewBookmark[]): Promise<Bookmark[]> {
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
      favicon: input.favicon || faviconForUrl(input.url),
    },
  }))
  await idbBulkPut(STORE_NODES, nodes)
  notifyFilesUpdated()
  return nodes.map(nodeToBookmark)
}

export async function updateBookmark(
  id: string,
  patch: Partial<Omit<Bookmark, "id" | "createdAt">>,
): Promise<void> {
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
  // 与 add/bulkAdd/delete 一致: 通知「我的」更新, 否则 keep-alive 的概览时间线在改名后会陈旧。
  notifyFilesUpdated()
}

/** 删除书签 (软删标记; 撤销靠 restoreBookmark 恢复)。 */
export async function deleteBookmark(id: string): Promise<void> {
  const now = Date.now()
  const bookmark = await idbGet<BookmarkNode>(STORE_NODES, id)
  if (bookmark && bookmark.kind === "bookmark" && isLive(bookmark)) {
    await captureTrashSnapshot(bookmark)
  }
  await idbReadModifyWrite<BookmarkNode>(STORE_NODES, id, (current) =>
    current && current.kind === "bookmark"
      ? { ...current, deletedAt: now, updatedAt: now }
      : undefined,
  )
  notifyFilesUpdated()
}

export type { InsertPos as BookmarkInsertPos }

type BookmarkTreeItem = { id: string; parentId: string | null; sortKey: string; title: string }

async function liveBookmarkTreeItems(): Promise<BookmarkTreeItem[]> {
  const bookmarks = (await allBookmarkNodes()).filter(isLive)
  const folders = (await allFolderNodes()).filter(isLive)
  return [
    ...bookmarks.map((n) => ({
      id: n.id,
      parentId: n.parentId,
      sortKey: n.sortKey,
      title: n.title,
    })),
    ...folders.map((n) => ({
      id: n.id,
      parentId: n.parentId,
      sortKey: n.sortKey,
      title: n.title,
    })),
  ]
}

/** 书签移入收藏夹 / 同级重排 (收藏夹仅作父, 不可嵌套)。 */
export async function moveBookmark(
  id: string,
  newParentId: string | null,
  pos?: InsertPos,
): Promise<void> {
  if (newParentId !== null) {
    const folder = await idbGet<FolderNode>(STORE_NODES, newParentId)
    if (!folder || folder.kind !== "folder" || !isLive(folder)) throw new Error("目标收藏夹不存在")
  }
  const live = await liveBookmarkTreeItems()
  if (!live.some((n) => n.id === id)) return
  const sortKey = computeSiblingSortKey(live, newParentId, pos, id)
  await idbReadModifyWrite<BookmarkNode>(STORE_NODES, id, (current) =>
    current && current.kind === "bookmark"
      ? { ...current, parentId: newParentId, sortKey, updatedAt: Date.now() }
      : undefined,
  )
  notifyFilesUpdated()
}

/** 收藏夹同级重排 (parentId 恒为 null)。 */
export async function moveFolder(id: string, pos?: InsertPos): Promise<void> {
  const live = await liveBookmarkTreeItems()
  if (!live.some((n) => n.id === id)) return
  const sortKey = computeSiblingSortKey(live, null, pos, id)
  await idbReadModifyWrite<FolderNode>(STORE_NODES, id, (current) =>
    current && current.kind === "folder"
      ? { ...current, parentId: null, sortKey, updatedAt: Date.now() }
      : undefined,
  )
  notifyFilesUpdated()
}

/** 撤销删除: 把刚删除的书签恢复 (清删除标记 + bump updatedAt, 保留 id/createdAt/分组)。 */
export async function restoreBookmark(bookmark: Bookmark): Promise<void> {
  const now = Date.now()
  const existing = await allBookmarkNodes()
  const fallbackKey = nextKeys(maxKey(existing), 1)[0]
  await idbReadModifyWrite<BookmarkNode>(STORE_NODES, bookmark.id, (current) => {
    // 软删后删除标记节点仍在 → 复用其 sortKey 恢复; 极端兜底 (节点不存在) 用追加键重建。
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
  notifyFilesUpdated()
}
