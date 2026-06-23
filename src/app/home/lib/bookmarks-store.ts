// 链接收藏本地存储仓库 —— 基于 IndexedDB, 管理收藏夹 + 书签。
import { Bookmark, BookmarkFolder } from "../model"
import { genId } from "@/components/lib/id"
import {
  idbBulkPut,
  idbCount,
  idbDelete,
  idbGetAll,
  idbPut,
  idbReadModifyWrite,
  STORE_BOOKMARKS,
  STORE_FOLDERS,
} from "@/components/lib/idb"
import { notifyHubUpdated } from "./flowback"

/** 从 URL 推断 favicon (Google s2 服务), 失败时图标位降级为占位 */
export function faviconFor(url: string): string {
  try {
    const host = new URL(url).hostname
    return `https://www.google.com/s2/favicons?domain=${host}&sz=64`
  } catch {
    return ""
  }
}

// ---- 收藏夹 ----

export async function listFolders(): Promise<BookmarkFolder[]> {
  const folders = await idbGetAll<BookmarkFolder>(STORE_FOLDERS)
  return folders.sort((a, b) => a.createdAt - b.createdAt)
}

export async function addFolder(name: string): Promise<BookmarkFolder> {
  const folder: BookmarkFolder = {
    id: genId("fld"),
    name: name.trim() || "未命名收藏夹",
    createdAt: Date.now(),
  }
  await idbPut(STORE_FOLDERS, folder)
  return folder
}

export async function renameFolder(id: string, name: string): Promise<void> {
  await idbReadModifyWrite<BookmarkFolder>(STORE_FOLDERS, id, (current) =>
    current ? { ...current, name: name.trim() || current.name } : undefined,
  )
}

/** 删除收藏夹; 夹内书签移动到未分组 (folderId = null) */
export async function deleteFolder(id: string): Promise<void> {
  const bookmarks = await listBookmarks()
  const orphans = bookmarks.filter((b) => b.folderId === id).map((b) => ({ ...b, folderId: null }))
  if (orphans.length) await idbBulkPut(STORE_BOOKMARKS, orphans)
  await idbDelete(STORE_FOLDERS, id)
}

// ---- 书签 ----

export async function listBookmarks(): Promise<Bookmark[]> {
  const items = await idbGetAll<Bookmark>(STORE_BOOKMARKS)
  return items.sort((a, b) => b.createdAt - a.createdAt)
}

/** 书签数 —— 走 count(), 仅需数量徽标时用 (不反序列化全部书签)。 */
export async function countBookmarks(): Promise<number> {
  return idbCount(STORE_BOOKMARKS)
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
  const bookmark: Bookmark = {
    id: genId("bm"),
    title: input.title.trim() || input.url,
    url: input.url.trim(),
    description: input.description?.trim() ?? "",
    favicon: input.favicon || faviconFor(input.url),
    folderId: input.folderId ?? null,
    tags: input.tags ?? [],
    createdAt: Date.now(),
  }
  await idbPut(STORE_BOOKMARKS, bookmark)
  notifyHubUpdated()
  return bookmark
}

/** 批量导入 (浏览器书签导入用), 一次事务写入 */
export async function bulkAddBookmarks(inputs: NewBookmark[]): Promise<Bookmark[]> {
  const now = Date.now()
  const bookmarks: Bookmark[] = inputs.map((input, i) => ({
    // 批量导入在同一毫秒内生成, 追加下标 i 保证批内 ID 一定互不相同
    // (仅靠 genId 的随机后缀无法杜绝同毫秒碰撞, 碰撞会被 idbBulkPut 的 put 静默覆盖)
    id: `${genId("bm")}_${i}`,
    title: input.title.trim() || input.url,
    url: input.url.trim(),
    description: input.description?.trim() ?? "",
    favicon: input.favicon || faviconFor(input.url),
    folderId: input.folderId ?? null,
    tags: input.tags ?? [],
    // 保持导入顺序, 后导入的略晚
    createdAt: now + i,
  }))
  await idbBulkPut(STORE_BOOKMARKS, bookmarks)
  notifyHubUpdated()
  return bookmarks
}

export async function updateBookmark(
  id: string,
  patch: Partial<Omit<Bookmark, "id" | "createdAt">>,
): Promise<void> {
  // 单事务读-改-写 + 按主键单取 (旧实现 listBookmarks 全表扫描定位一条, 量大时 O(n) 且放大竞态窗口)。
  await idbReadModifyWrite<Bookmark>(STORE_BOOKMARKS, id, (current) =>
    current ? { ...current, ...patch } : undefined,
  )
}

export async function deleteBookmark(id: string): Promise<void> {
  await idbDelete(STORE_BOOKMARKS, id)
  notifyHubUpdated()
}

/** 撤销删除: 把刚删除的书签原样写回 (保留 id/createdAt/分组, 非新建)。 */
export async function restoreBookmark(bookmark: Bookmark): Promise<void> {
  await idbPut(STORE_BOOKMARKS, bookmark)
  notifyHubUpdated()
}
