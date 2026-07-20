// 链接收藏本地存储仓库 —— 折叠步 B 后物理统一到 nodes 仓库 (kind:"bookmark"/"folder")。
// 对外仍以 Bookmark / BookmarkFolder 域类型呈现 (节点↔域类型映射在本仓库边界完成), 消费方零改:
//   - 书签节点: folderId→parentId, url/description/favicon 收进 content, title/tags 留顶层;
//   - 收藏夹节点: name→title, 根级 (parentId=null);
//   - 删除走软删标记 (deletedAt, 与笔记/关注一致), 读路径过滤删除标记 —— 当前用于撤销跨刷新稳健, 并为后续同步就绪。
// 收藏夹与书签作为同一个加密域同步；完整快照 CAS、墓碑 GC 与恢复快照在同一事务落地。
import { Bookmark, BookmarkFolder } from "@protocol/files"
import type { Node, NodeKind, NodeOfKind } from "@protocol/node"
import { StorageSyncConflictError, type BookmarkSyncNode } from "@protocol/storage-sync"
import { faviconForUrl } from "@/lib/favicon"
import { genId } from "@/lib/id"
import { canonicalHttpUrl } from "@/lib/canonical-http-url"
import { expiredTombstoneIdsToDelete, isLive, recordsEqual } from "@protocol/sync"
import { cmpSibling, computeSiblingSortKey, type InsertPos } from "@/files/notes-tree-util"
import {
  idbGetAllFromIndex,
  idbReadModifyWrite,
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

type BookmarkNode = NodeOfKind<"bookmark">
type FolderNode = NodeOfKind<"folder">

type BookmarkTreeSnapshot = {
  bookmarks: BookmarkNode[]
  folders: FolderNode[]
}

function readBookmarkTreeSnapshot(
  store: IDBObjectStore,
  complete: (snapshot: BookmarkTreeSnapshot) => void,
  abort: (error: unknown) => void,
): void {
  const index = store.index(INDEX_NODES_KIND)
  const bookmarkRequest = index.getAll("bookmark")
  const folderRequest = index.getAll("folder")
  let bookmarks: BookmarkNode[] | undefined
  let folders: FolderNode[] | undefined
  let failed = false
  const fail = (error: unknown) => {
    if (failed) return
    failed = true
    abort(error)
  }
  const finish = () => {
    if (failed || !bookmarks || !folders) return
    try {
      complete({ bookmarks, folders })
    } catch (error) {
      fail(error)
    }
  }
  bookmarkRequest.onerror = () => fail(bookmarkRequest.error ?? new Error("读取书签树快照失败"))
  bookmarkRequest.onsuccess = () => {
    bookmarks = (bookmarkRequest.result as Node[]).filter(
      (node): node is BookmarkNode => node.kind === "bookmark",
    )
    finish()
  }
  folderRequest.onerror = () => fail(folderRequest.error ?? new Error("读取收藏夹树快照失败"))
  folderRequest.onsuccess = () => {
    folders = (folderRequest.result as Node[]).filter(
      (node): node is FolderNode => node.kind === "folder",
    )
    finish()
  }
}

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

// ---- 跨端同步钩子 (仅由 core StorageSyncPort adapter 暴露给 sync 插件) ----

/** 收藏夹与书签必须作为同一快照读取，避免同步只观察到父或子的一半。 */
export async function listAllBookmarkNodes(): Promise<BookmarkSyncNode[]> {
  return idbRunTransaction<BookmarkSyncNode[]>(
    [STORE_NODES],
    "readonly",
    (transaction, setResult, abort) => {
      readBookmarkTreeSnapshot(
        transaction.objectStore(STORE_NODES),
        ({ folders, bookmarks }) => setResult([...folders, ...bookmarks]),
        abort,
      )
    },
  )
}

/** 仅当本地仍匹配同步读取快照时，原子写入收藏夹、书签与墓碑 GC。 */
export async function bulkPutBookmarkNodes(
  nodes: BookmarkSyncNode[],
  expectedLocal: BookmarkSyncNode[],
): Promise<BookmarkSyncNode[]> {
  const outcome = await idbRunTransaction<{ items: BookmarkSyncNode[]; changed: boolean }>(
    [STORE_NODES, STORE_TRASH_SNAPSHOTS],
    "readwrite",
    (transaction, setResult, abort) => {
      const store = transaction.objectStore(STORE_NODES)
      const trashStore = transaction.objectStore(STORE_TRASH_SNAPSHOTS)
      readBookmarkTreeSnapshot(
        store,
        ({ folders, bookmarks }) => {
          const actual: BookmarkSyncNode[] = [...folders, ...bookmarks]
          const batchIds = new Set<string>()
          for (const node of nodes) {
            if (batchIds.has(node.id)) throw new Error(`书签同步批次包含重复 id: ${node.id}`)
            batchIds.add(node.id)
          }
          const activeFolderIds = new Set(
            nodes.filter((node) => node.kind === "folder" && isLive(node)).map((node) => node.id),
          )
          for (const node of nodes) {
            if (node.kind === "folder" && node.parentId !== null) {
              throw new Error(`书签同步收藏夹不能嵌套: ${node.id}`)
            }
            if (
              node.kind === "bookmark" &&
              isLive(node) &&
              node.parentId !== null &&
              !activeFolderIds.has(node.parentId)
            ) {
              throw new Error(`书签同步批次包含孤儿书签: ${node.id}`)
            }
          }
          if (recordsEqual(actual, nodes)) {
            for (const node of nodes) {
              if (isLive(node)) trashStore.delete(node.id)
            }
            setResult({ items: actual, changed: false })
            return
          }
          if (!recordsEqual(actual, expectedLocal)) {
            throw new StorageSyncConflictError("书签")
          }

          const existingById = new Map(actual.map((node) => [node.id, node]))
          const keepIds = new Set(nodes.map((node) => node.id))
          const now = Date.now()
          const toDelete = expiredTombstoneIdsToDelete(actual, keepIds, now)
          for (const node of nodes) {
            const current = existingById.get(node.id)
            if (current && current.kind !== node.kind) {
              throw new Error(`书签同步不能改变节点 kind: ${node.id}`)
            }
            if (isLive(node)) {
              trashStore.delete(node.id)
            } else if (current && isLive(current)) {
              trashStore.put({
                id: current.id,
                node: current,
                capturedAt: now,
              } satisfies TrashSnapshot)
            }
            // 新 id 使用 add，若撞到 note/file 等其它 kind，事务以 ConstraintError 整批回滚。
            if (current) store.put(node)
            else store.add(node)
          }
          for (const id of toDelete) {
            store.delete(id)
            trashStore.delete(id)
          }
          setResult({ items: nodes, changed: true })
        },
        abort,
      )
    },
  )
  if (outcome.changed) {
    notifyFilesUpdated({ kind: "folder" })
    notifyFilesUpdated({ kind: "bookmark" })
  }
  return outcome.items
}

// ---- 收藏夹 ----

export async function listFolders(): Promise<BookmarkFolder[]> {
  const folders = (await allFolderNodes()).filter(isLive).map(nodeToFolder)
  return folders.sort((a, b) => a.createdAt - b.createdAt)
}

/** 新建收藏夹并返回同一写事务实际提交的统一 Node。 */
export async function addFolderWithNode(name: string): Promise<FolderNode> {
  const now = Date.now()
  const id = genId("fld")
  const node = await idbRunTransaction<FolderNode>(
    [STORE_NODES],
    "readwrite",
    (transaction, setResult, abort) => {
      addNodeAtKindTail(
        transaction.objectStore(STORE_NODES),
        { kind: "folder", parentId: null },
        (sortKey) => ({
          id,
          kind: "folder",
          title: name.trim() || "未命名收藏夹",
          parentId: null,
          sortKey,
          tags: [],
          createdAt: now,
          updatedAt: now,
          content: null,
        }),
        setResult,
        abort,
      )
    },
  )
  notifyFilesUpdated({ kind: "folder", id: node.id })
  return node
}

/** 兼容既有 FilesPort DTO；创建真相由 addFolderWithNode 返回。 */
export async function addFolder(name: string): Promise<BookmarkFolder> {
  return nodeToFolder(await addFolderWithNode(name))
}

export async function renameFolder(
  id: string,
  name: string,
  expected?: NodeMutationExpectation,
): Promise<FolderNode | undefined> {
  const updated = await idbReadModifyWrite<FolderNode>(STORE_NODES, id, (current) => {
    assertNodeMutationExpectation(current, expected)
    return current && current.kind === "folder" && isLive(current)
      ? {
          ...current,
          title: name.trim() || current.title,
          updatedAt: nextUpdatedAt(current.updatedAt),
        }
      : undefined
  })
  if (updated) notifyFilesUpdated({ kind: "folder", id })
  return updated
}

/** 删除收藏夹 (软删标记); 夹内活跃书签移动到未分组 (parentId = null)。 */
export async function deleteFolder(
  id: string,
  expected?: NodeMutationExpectation,
): Promise<boolean> {
  const now = Date.now()
  const outcome = await idbRunTransaction<{ deleted: boolean; moved: BookmarkNode[] }>(
    [STORE_NODES, STORE_TRASH_SNAPSHOTS],
    "readwrite",
    (transaction, setResult, abort) => {
      const store = transaction.objectStore(STORE_NODES)
      const trashStore = transaction.objectStore(STORE_TRASH_SNAPSHOTS)
      const request = store.get(id)
      request.onerror = () => abort(request.error ?? new Error("读取待删除收藏夹失败"))
      request.onsuccess = () => {
        try {
          const current = request.result as Node | undefined
          assertNodeMutationExpectation(current, expected)
          if (!current || current.kind !== "folder" || !isLive(current)) {
            setResult({ deleted: false, moved: [] })
            return
          }
          readBookmarkTreeSnapshot(
            store,
            ({ bookmarks, folders }) => {
              const orphans = bookmarks
                .filter(isLive)
                .filter((bookmark) => bookmark.parentId === id)
                .sort(cmpSibling)
              const orphanIds = new Set(orphans.map((bookmark) => bookmark.id))
              // 删除后的根快照不含目标 folder 和待迁移 children；逐项追加可保持 child 相对顺序，
              // 同时避免把原 folder 内的局部 sortKey 原样带到跨 kind 根目录。
              const tree = bookmarkTreeItems({
                bookmarks: bookmarks.filter((bookmark) => !orphanIds.has(bookmark.id)),
                folders: folders.filter((candidate) => candidate.id !== id),
              })
              const moved = orphans.map((bookmark) => {
                const next: BookmarkNode = {
                  ...bookmark,
                  parentId: null,
                  sortKey: computeSiblingSortKey(tree, null, undefined, bookmark.id),
                  updatedAt: nextUpdatedAt(bookmark.updatedAt, now),
                }
                tree.push({
                  id: next.id,
                  parentId: null,
                  sortKey: next.sortKey,
                  title: next.title,
                })
                store.put(next)
                return next
              })
              trashStore.put({
                id: current.id,
                node: current,
                capturedAt: now,
              } satisfies TrashSnapshot)
              store.put({
                ...current,
                deletedAt: now,
                updatedAt: nextUpdatedAt(current.updatedAt, now),
              } satisfies FolderNode)
              setResult({ deleted: true, moved })
            },
            abort,
          )
        } catch (error) {
          abort(error)
        }
      }
    },
  )
  for (const bookmark of outcome.moved) {
    notifyFilesUpdated({ kind: "bookmark", id: bookmark.id })
  }
  if (outcome.deleted) notifyFilesUpdated({ kind: "folder", id })
  return outcome.deleted
}

// ---- 书签 ----

export async function listBookmarks(): Promise<Bookmark[]> {
  const items = (await allBookmarkNodes()).filter(isLive).map(nodeToBookmark)
  return items.sort((a, b) => b.createdAt - a.createdAt)
}

export type NewBookmark = {
  title: string
  url: string
  description?: string
  favicon?: string
  folderId?: string | null
  tags?: string[]
}

/** 新建书签并返回同一写事务实际提交的统一 Node。 */
export async function addBookmarkWithNode(input: NewBookmark): Promise<BookmarkNode> {
  const now = Date.now()
  const id = genId("bm")
  const parentId = input.folderId ?? null
  const node = await idbRunTransaction<BookmarkNode>(
    [STORE_NODES],
    "readwrite",
    (transaction, setResult, abort) => {
      const store = transaction.objectStore(STORE_NODES)
      const append = () =>
        addNodeAtKindTail(
          store,
          { kind: "bookmark", parentId },
          (sortKey) => ({
            id,
            kind: "bookmark",
            title: input.title.trim() || input.url,
            parentId,
            sortKey,
            tags: input.tags ?? [],
            createdAt: now,
            updatedAt: now,
            content: {
              url: input.url.trim(),
              description: input.description?.trim() ?? "",
              favicon: input.favicon || faviconForUrl(input.url),
            },
          }),
          setResult,
          abort,
        )
      if (parentId === null) append()
      else {
        const folderRequest = store.get(parentId)
        folderRequest.onerror = () => abort(folderRequest.error ?? new Error("读取目标收藏夹失败"))
        folderRequest.onsuccess = () => {
          try {
            const folder = folderRequest.result as Node | undefined
            if (!folder || folder.kind !== "folder" || !isLive(folder)) {
              throw new Error("目标收藏夹不存在")
            }
            append()
          } catch (error) {
            abort(error)
          }
        }
      }
    },
  )
  notifyFilesUpdated({ kind: "bookmark", id: node.id })
  return node
}

/** 兼容既有 FilesPort DTO；创建真相由 addBookmarkWithNode 返回。 */
export async function addBookmark(input: NewBookmark): Promise<Bookmark> {
  return nodeToBookmark(await addBookmarkWithNode(input))
}

export type CaptureBookmarkStoreResult = Readonly<{
  status: "created" | "existing"
  bookmark: Bookmark
}>

/**
 * 把外部内容幂等捕获为根级书签。
 *
 * canonical URL 检查与创建位于同一个 IndexedDB readwrite 事务内，因此新闻、社区、
 * 浏览器或多个窗口同时捕获同一链接时只会提交一个对象。页面锚点不参与资产身份，
 * query 仍保留；已归档对象只返回 existing，不会被静默重新放回收件箱。
 */
export async function captureBookmark(
  input: Omit<NewBookmark, "folderId">,
): Promise<CaptureBookmarkStoreResult> {
  const url = input.url.trim()
  const canonical = canonicalHttpUrl(url)
  if (!canonical) throw new Error("只能捕获 HTTP(S) 链接")

  const now = Date.now()
  const id = genId("bm")
  const outcome = await idbRunTransaction<{
    status: "created" | "existing"
    node: BookmarkNode
  }>([STORE_NODES], "readwrite", (transaction, setResult, abort) => {
    const store = transaction.objectStore(STORE_NODES)
    const request = store.index(INDEX_NODES_KIND).getAll("bookmark")
    request.onerror = () => abort(request.error ?? new Error("读取书签失败"))
    request.onsuccess = () => {
      try {
        const existing = (request.result as Node[]).find((candidate): candidate is BookmarkNode => {
          if (candidate.kind !== "bookmark" || !isLive(candidate)) return false
          return canonicalHttpUrl(candidate.content.url) === canonical
        })
        if (existing) {
          setResult({ status: "existing", node: existing })
          return
        }

        addNodeAtKindTail(
          store,
          { kind: "bookmark", parentId: null },
          (sortKey) => ({
            id,
            kind: "bookmark",
            title: input.title.trim() || url,
            parentId: null,
            sortKey,
            tags: [...new Set(input.tags ?? [])],
            createdAt: now,
            updatedAt: now,
            content: {
              url,
              description: input.description?.trim() ?? "",
              favicon: input.favicon || faviconForUrl(url),
            },
          }),
          (node) => setResult({ status: "created", node }),
          abort,
        )
      } catch (error) {
        abort(error)
      }
    }
  })

  if (outcome.status === "created") {
    notifyFilesUpdated({ kind: "bookmark", id: outcome.node.id })
  }
  return { status: outcome.status, bookmark: nodeToBookmark(outcome.node) }
}

export async function updateBookmark(
  id: string,
  patch: Partial<Omit<Bookmark, "id" | "createdAt">>,
  expected?: NodeMutationExpectation,
): Promise<BookmarkNode | undefined> {
  const hasFields =
    patch.url !== undefined ||
    patch.description !== undefined ||
    patch.favicon !== undefined ||
    patch.title !== undefined ||
    patch.tags !== undefined
  if (!hasFields && patch.folderId === undefined) return undefined
  let changed = hasFields
  const applyFields = (current: BookmarkNode): BookmarkNode => {
    const content = { ...current.content }
    if (patch.url !== undefined) content.url = patch.url
    if (patch.description !== undefined) content.description = patch.description
    if (patch.favicon !== undefined) content.favicon = patch.favicon
    const next: BookmarkNode = {
      ...current,
      content,
      updatedAt: nextUpdatedAt(current.updatedAt),
    }
    if (patch.title !== undefined) next.title = patch.title
    if (patch.tags !== undefined) next.tags = patch.tags
    return next
  }
  const updated =
    patch.folderId === undefined
      ? await idbReadModifyWrite<BookmarkNode>(STORE_NODES, id, (current) => {
          assertNodeMutationExpectation(current, expected)
          if (!current || current.kind !== "bookmark" || !isLive(current)) return undefined
          return applyFields(current)
        })
      : await idbRunTransaction<BookmarkNode | undefined>(
          [STORE_NODES],
          "readwrite",
          (transaction, setResult, abort) => {
            const store = transaction.objectStore(STORE_NODES)
            const request = store.get(id)
            request.onerror = () => abort(request.error ?? new Error("读取待更新书签失败"))
            request.onsuccess = () => {
              try {
                const current = request.result as Node | undefined
                assertNodeMutationExpectation(current, expected)
                if (!current || current.kind !== "bookmark" || !isLive(current)) {
                  setResult(undefined)
                  return
                }
                readBookmarkTreeSnapshot(
                  store,
                  (snapshot) => {
                    const parentId = patch.folderId as string | null
                    if (
                      parentId !== null &&
                      !snapshot.folders.some((folder) => folder.id === parentId && isLive(folder))
                    ) {
                      throw new Error("目标收藏夹不存在")
                    }
                    const parentChanged = current.parentId !== parentId
                    if (!parentChanged && !hasFields) {
                      setResult(current)
                      return
                    }
                    changed = true
                    const next: BookmarkNode = {
                      ...applyFields(current),
                      parentId,
                      sortKey: parentChanged
                        ? computeSiblingSortKey(
                            bookmarkTreeItems(snapshot),
                            parentId,
                            undefined,
                            id,
                          )
                        : current.sortKey,
                    }
                    const putRequest = store.put(next)
                    putRequest.onerror = () =>
                      abort(putRequest.error ?? new Error("更新书签字段与位置失败"))
                    putRequest.onsuccess = () => setResult(next)
                  },
                  abort,
                )
              } catch (error) {
                abort(error)
              }
            }
          },
        )
  // 与 add/bulkAdd/delete 一致: 通知「我的」更新, 否则 keep-alive 的概览时间线在改名后会陈旧。
  if (updated && changed) notifyFilesUpdated({ kind: "bookmark", id })
  return updated
}

/** 删除书签 (软删标记; 撤销靠 restoreBookmark 恢复)。 */
export async function deleteBookmark(
  id: string,
  expected?: NodeMutationExpectation,
): Promise<boolean> {
  const deleted = await idbRunTransaction<boolean>(
    [STORE_NODES, STORE_TRASH_SNAPSHOTS],
    "readwrite",
    (transaction, setResult, abort) => {
      const nodeStore = transaction.objectStore(STORE_NODES)
      const trashStore = transaction.objectStore(STORE_TRASH_SNAPSHOTS)
      const request = nodeStore.get(id)
      request.onerror = () => abort(request.error ?? new Error("读取待删除书签失败"))
      request.onsuccess = () => {
        try {
          const current = request.result as Node | undefined
          assertNodeMutationExpectation(current, expected)
          if (!current || current.kind !== "bookmark" || !isLive(current)) {
            setResult(false)
            return
          }
          const now = Date.now()
          trashStore.put({
            id: current.id,
            node: current,
            capturedAt: now,
          } satisfies TrashSnapshot)
          nodeStore.put({
            ...current,
            deletedAt: now,
            updatedAt: nextUpdatedAt(current.updatedAt, now),
          } satisfies BookmarkNode)
          setResult(true)
        } catch (error) {
          abort(error)
        }
      }
    },
  )
  if (deleted) notifyFilesUpdated({ kind: "bookmark", id })
  return deleted
}

export type { InsertPos as BookmarkInsertPos }

type BookmarkTreeItem = { id: string; parentId: string | null; sortKey: string; title: string }

function bookmarkTreeItems({ bookmarks, folders }: BookmarkTreeSnapshot): BookmarkTreeItem[] {
  return [
    ...bookmarks.filter(isLive).map((n) => ({
      id: n.id,
      parentId: n.parentId,
      sortKey: n.sortKey,
      title: n.title,
    })),
    ...folders.filter(isLive).map((n) => ({
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
  expected?: NodeMutationExpectation,
): Promise<BookmarkNode | undefined> {
  const moved = await idbRunTransaction<BookmarkNode | undefined>(
    [STORE_NODES],
    "readwrite",
    (transaction, setResult, abort) => {
      const store = transaction.objectStore(STORE_NODES)
      const request = store.get(id)
      request.onerror = () => abort(request.error ?? new Error("读取待移动书签失败"))
      request.onsuccess = () => {
        try {
          const current = request.result as Node | undefined
          assertNodeMutationExpectation(current, expected)
          if (!current || current.kind !== "bookmark" || !isLive(current)) {
            setResult(undefined)
            return
          }
          readBookmarkTreeSnapshot(
            store,
            (snapshot) => {
              if (
                newParentId !== null &&
                !snapshot.folders.some((folder) => folder.id === newParentId && isLive(folder))
              ) {
                throw new Error("目标收藏夹不存在")
              }
              const next: BookmarkNode = {
                ...current,
                parentId: newParentId,
                sortKey: computeSiblingSortKey(bookmarkTreeItems(snapshot), newParentId, pos, id),
                updatedAt: nextUpdatedAt(current.updatedAt),
              }
              const putRequest = store.put(next)
              putRequest.onerror = () => abort(putRequest.error ?? new Error("移动书签失败"))
              putRequest.onsuccess = () => setResult(next)
            },
            abort,
          )
        } catch (error) {
          abort(error)
        }
      }
    },
  )
  if (moved) notifyFilesUpdated({ kind: "bookmark", id })
  return moved
}

/** 收藏夹同级重排 (parentId 恒为 null)。 */
export async function moveFolder(
  id: string,
  pos?: InsertPos,
  expected?: NodeMutationExpectation,
): Promise<FolderNode | undefined> {
  const moved = await idbRunTransaction<FolderNode | undefined>(
    [STORE_NODES],
    "readwrite",
    (transaction, setResult, abort) => {
      const store = transaction.objectStore(STORE_NODES)
      const request = store.get(id)
      request.onerror = () => abort(request.error ?? new Error("读取待移动收藏夹失败"))
      request.onsuccess = () => {
        try {
          const current = request.result as Node | undefined
          assertNodeMutationExpectation(current, expected)
          if (!current || current.kind !== "folder" || !isLive(current)) {
            setResult(undefined)
            return
          }
          readBookmarkTreeSnapshot(
            store,
            (snapshot) => {
              const next: FolderNode = {
                ...current,
                parentId: null,
                sortKey: computeSiblingSortKey(bookmarkTreeItems(snapshot), null, pos, id),
                updatedAt: nextUpdatedAt(current.updatedAt),
              }
              const putRequest = store.put(next)
              putRequest.onerror = () => abort(putRequest.error ?? new Error("移动收藏夹失败"))
              putRequest.onsuccess = () => setResult(next)
            },
            abort,
          )
        } catch (error) {
          abort(error)
        }
      }
    },
  )
  if (moved) notifyFilesUpdated({ kind: "folder", id })
  return moved
}

/** 撤销删除: 把刚删除的书签恢复 (清删除标记 + bump updatedAt, 保留 id/createdAt/分组)。 */
export async function restoreBookmark(bookmark: Bookmark): Promise<void> {
  const now = Date.now()
  await idbRunTransaction<void>([STORE_NODES], "readwrite", (transaction, setResult, abort) => {
    const store = transaction.objectStore(STORE_NODES)
    const request = store.get(bookmark.id)
    request.onerror = () => abort(request.error ?? new Error("读取待恢复书签失败"))
    request.onsuccess = () => {
      try {
        const current = request.result as Node | undefined
        if (current && current.kind !== "bookmark") {
          throw new Error("待恢复书签 id 已被其它节点占用")
        }
        const restore = (parentId: string | null) => {
          const revive = (base: BookmarkNode, existed: boolean): BookmarkNode => {
            const revived: BookmarkNode = {
              ...base,
              title: bookmark.title,
              parentId,
              tags: bookmark.tags,
              content: {
                url: bookmark.url,
                description: bookmark.description,
                favicon: bookmark.favicon,
              },
              updatedAt: existed ? nextUpdatedAt(base.updatedAt, now) : now,
            }
            delete revived.deletedAt
            return revived
          }
          if (current) {
            store.put(revive(current, true))
            setResult(undefined)
            return
          }
          addNodeAtKindTail(
            store,
            { kind: "bookmark", parentId },
            (sortKey) => revive(bookmarkToNode(bookmark, sortKey, now), false),
            () => setResult(undefined),
            abort,
          )
        }
        if (bookmark.folderId === null) restore(null)
        else {
          const folderRequest = store.get(bookmark.folderId)
          folderRequest.onerror = () =>
            abort(folderRequest.error ?? new Error("读取恢复目标收藏夹失败"))
          folderRequest.onsuccess = () => {
            try {
              const folder = folderRequest.result as Node | undefined
              restore(folder?.kind === "folder" && isLive(folder) ? folder.id : null)
            } catch (error) {
              abort(error)
            }
          }
        }
      } catch (error) {
        abort(error)
      }
    }
  })
  notifyFilesUpdated({ kind: "bookmark", id: bookmark.id })
}
