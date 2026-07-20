// 统一 Node 库的跨 kind 只读读取层 —— 供侧栏「一切皆文件」文件树 / places 导航。
// 跨 kind 汇总读 STORE_NODES; 写路径仍走各 kind 专属 store (notes-store/bookmarks-store/...), 此处不重复写逻辑。
import type { Node, NodeKind, FsCreateInput, FsWritePatch } from "@protocol/node"
import { NODE_KINDS } from "@protocol/node"
import type { SubscriptionType } from "@protocol/subscription"
import { bytesToBase64 } from "@/lib/base64"
import { safeHref } from "@/lib/safe-url"
import {
  idbGet,
  idbGetAllFromIndex,
  idbGetMany,
  idbRunTransaction,
  INDEX_NODES_KIND,
  INDEX_NODES_KIND_SORT_TITLE_ID,
  INDEX_NODES_PARENT_ID,
  STORE_NODES,
} from "@/lib/idb"
import { buildParentOf, effectiveParentId, type TreeItem } from "@/files/notes-tree-util"
import { addNoteWithNode, updateNote, moveNote, deleteNote } from "@/files/stores/notes-store"
import {
  addBookmarkWithNode,
  updateBookmark,
  deleteBookmark,
  addFolderWithNode,
  renameFolder,
  deleteFolder,
  moveBookmark,
  moveFolder,
} from "@/files/stores/bookmarks-store"
import { updateFileMeta, deleteFile, getFile } from "@/files/stores/files-store"
import { addSubscriptionWithNode, removeSubscription } from "@/files/stores/subscriptions-store"
import { createThreadWithNode, deleteThread, updateThread } from "@/files/stores/threads-store"
import {
  restoreNoteTrashSubtreeWithRoot,
  restoreTrashItemWithNode,
  type TrashMutationExpectation,
} from "@/files/stores/trash-store"
import {
  assertNodeMutationExpectation,
  nodeMutationExpectation,
  type NodeMutationExpectation,
} from "@/files/stores/node-mutation"

export { getThreadMetadataMany, listThreadMetadata } from "./thread-metadata-store"

/** 跨 kind 节点摘要 (侧栏文件树用): TreeItem + kind + 是否有活跃子节点。 */
export interface NodeSummary extends TreeItem {
  kind: NodeKind
  hasChildren: boolean
  mime?: string
}

export type NodeSummaryPage = Readonly<{
  items: NodeSummary[]
  nextCursor?: string
}>

export type NodeSummaryPageOptions = Readonly<{
  limit: number
  cursor?: string
  /** undefined=不限制父级；null=根级；string=指定父节点。 */
  parentId?: string | null
}>

/** 全部本地 node kind (fs.list kind 缺省时遍历全部)。 */
export const ALL_NODE_KINDS: NodeKind[] = [...NODE_KINDS]

type RawNode = {
  id: string
  kind?: NodeKind
  title?: string
  parentId?: string | null
  sortKey?: string
  deletedAt?: number
  blobRef?: { mime?: string }
}

type NodeSummaryCursorPosition = Readonly<{ sortKey: string; title: string; id: string }>
type NodeSummaryCursor = Readonly<{
  version: 1
  positions: Partial<Record<NodeKind, NodeSummaryCursorPosition>>
}>

function decodeNodeSummaryCursor(raw: string | undefined): NodeSummaryCursor {
  if (raw === undefined) return { version: 1, positions: {} }
  if (raw.length > 8192) throw new Error("节点目录 cursor 过长")
  let value: unknown
  try {
    value = JSON.parse(decodeURIComponent(raw)) as unknown
  } catch {
    throw new Error("节点目录 cursor 无效")
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("节点目录 cursor 无效")
  }
  const candidate = value as { version?: unknown; positions?: unknown }
  if (
    candidate.version !== 1 ||
    !candidate.positions ||
    typeof candidate.positions !== "object" ||
    Array.isArray(candidate.positions)
  ) {
    throw new Error("节点目录 cursor 无效")
  }
  const positions: Partial<Record<NodeKind, NodeSummaryCursorPosition>> = {}
  for (const [kind, position] of Object.entries(candidate.positions)) {
    if (!NODE_KINDS.includes(kind as NodeKind)) throw new Error("节点目录 cursor kind 无效")
    if (!position || typeof position !== "object" || Array.isArray(position)) {
      throw new Error("节点目录 cursor 位置无效")
    }
    const item = position as { sortKey?: unknown; title?: unknown; id?: unknown }
    if (
      typeof item.sortKey !== "string" ||
      typeof item.title !== "string" ||
      typeof item.id !== "string"
    ) {
      throw new Error("节点目录 cursor 位置无效")
    }
    positions[kind as NodeKind] = { sortKey: item.sortKey, title: item.title, id: item.id }
  }
  return { version: 1, positions }
}

function encodeNodeSummaryCursor(
  positions: Partial<Record<NodeKind, NodeSummaryCursorPosition>>,
): string {
  return encodeURIComponent(JSON.stringify({ version: 1, positions } satisfies NodeSummaryCursor))
}

function compareNodeSummary(left: NodeSummary, right: NodeSummary): number {
  if (left.sortKey !== right.sortKey) return left.sortKey < right.sortKey ? -1 : 1
  if (left.title !== right.title) return left.title < right.title ? -1 : 1
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

function rawNodeSummary(node: RawNode & { kind: NodeKind }): NodeSummary {
  return {
    id: node.id,
    kind: node.kind,
    title: node.title ?? "",
    parentId: node.parentId ?? null,
    sortKey: node.sortKey ?? "",
    hasChildren: false,
    mime: node.kind === "file" ? (node.blobRef?.mime ?? "") : undefined,
  }
}

/**
 * 通过 covering sort 索引逐 kind 游标读取节点摘要；页内仅 clone 命中候选，避免侧栏首屏
 * 先把全部 note/thread 正文复制进 JS。多 kind cursor 分别保存续读位置，再做确定性归并。
 */
export async function listNodeSummaryPage(
  kinds: NodeKind[],
  options: NodeSummaryPageOptions,
): Promise<NodeSummaryPage> {
  const uniqueKinds = [...new Set(kinds)]
  if (uniqueKinds.length === 0) return { items: [] }
  if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 1000) {
    throw new Error("节点目录 limit 无效")
  }
  const decoded = decodeNodeSummaryCursor(options.cursor)
  const limit = options.limit
  return idbRunTransaction<NodeSummaryPage>(
    [STORE_NODES],
    "readonly",
    (transaction, setResult, abort) => {
      const store = transaction.objectStore(STORE_NODES)
      const sortIndex = store.index(INDEX_NODES_KIND_SORT_TITLE_ID)
      const candidates = new Map<NodeKind, NodeSummary[]>()
      const ended = new Map<NodeKind, boolean>()
      let pendingKinds = uniqueKinds.length
      let failed = false

      const fail = (error: unknown) => {
        if (failed) return
        failed = true
        abort(error)
      }

      const finalize = () => {
        if (failed || pendingKinds !== 0) return
        const merged = [...candidates.values()].flat().sort(compareNodeSummary)
        const page = merged.slice(0, limit)
        const hasMore =
          merged.length > limit || uniqueKinds.some((kind) => ended.get(kind) !== true)
        const positions = { ...decoded.positions }
        for (const item of page) {
          positions[item.kind] = { sortKey: item.sortKey, title: item.title, id: item.id }
        }

        if (page.length === 0) {
          setResult({ items: [] })
          return
        }
        const childIndex = store.index(INDEX_NODES_PARENT_ID)
        const wantedKinds = new Set(uniqueKinds)
        let pendingChildren = page.length
        const finishChild = () => {
          pendingChildren -= 1
          if (pendingChildren !== 0 || failed) return
          setResult({
            items: page,
            ...(hasMore ? { nextCursor: encodeNodeSummaryCursor(positions) } : {}),
          })
        }
        for (const item of page) {
          const request = childIndex.openCursor(IDBKeyRange.only(item.id))
          request.onerror = () => fail(request.error ?? new Error("读取节点子级状态失败"))
          request.onsuccess = () => {
            const cursor = request.result
            if (!cursor) {
              finishChild()
              return
            }
            const child = cursor.value as RawNode
            if (
              child.deletedAt == null &&
              child.kind !== undefined &&
              wantedKinds.has(child.kind)
            ) {
              item.hasChildren = true
              finishChild()
              return
            }
            cursor.continue()
          }
        }
      }

      const finishKind = (kind: NodeKind, reachedEnd: boolean) => {
        ended.set(kind, reachedEnd)
        pendingKinds -= 1
        finalize()
      }

      for (const kind of uniqueKinds) {
        const items: NodeSummary[] = []
        candidates.set(kind, items)
        const position = decoded.positions[kind]
        const range = position
          ? IDBKeyRange.bound(
              [kind, position.sortKey, position.title, position.id],
              [kind, []],
              true,
              false,
            )
          : IDBKeyRange.bound([kind], [kind, []])
        const request = sortIndex.openCursor(range)
        request.onerror = () => fail(request.error ?? new Error("读取节点目录失败"))
        request.onsuccess = () => {
          const cursor = request.result
          if (!cursor) {
            finishKind(kind, true)
            return
          }
          const node = cursor.value as RawNode
          const matchesParent =
            options.parentId === undefined || (node.parentId ?? null) === options.parentId
          if (node.kind === kind && node.deletedAt == null && matchesParent) {
            items.push(rawNodeSummary(node as RawNode & { kind: NodeKind }))
            if (items.length >= limit + 1) {
              finishKind(kind, false)
              return
            }
          }
          cursor.continue()
        }
      }
    },
  )
}

async function nodesByKinds<T extends { kind?: NodeKind }>(kinds: NodeKind[]): Promise<T[]> {
  const uniqueKinds = [...new Set(kinds)]
  const rows = await Promise.all(
    uniqueKinds.map((kind) => idbGetAllFromIndex<T>(STORE_NODES, INDEX_NODES_KIND, kind)),
  )
  return rows.flat()
}

/**
 * 列出指定 kind 的活跃节点摘要 (过滤删除标记)。供侧栏跨 kind 文件树 / places 导航。
 * hasChildren 仅在所请求 kinds 集合内计算 (跨 place 的父子不串台)。
 */
export async function listNodeSummaries(kinds: NodeKind[]): Promise<NodeSummary[]> {
  if (kinds.length === 0) return []
  const want = new Set(kinds)
  const all = await nodesByKinds<RawNode>(kinds)
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
    parentId: effectiveParentId(n.id, n.parentId ?? null, parentOf),
    sortKey: n.sortKey ?? "",
    hasChildren: withChildren.has(n.id),
    mime: n.kind === "file" ? (n.blobRef?.mime ?? "") : undefined,
  }))
}

// ---- AI fs.* 文件面的底层读 (§6); 隐私净化 stripNode 在 @protocol/node (纯函数, 跨层共用) ----

/** 取单个活跃完整节点 (供 fs.read; 调用方按 kind 二次 gate / 净化)。 */
export async function getNodeRaw(id: string): Promise<Node | undefined> {
  const n = await idbGet<Node>(STORE_NODES, id)
  if (!n || n.deletedAt != null) return undefined
  return n
}

/** mutation CAS/restore 专用：返回原始节点，包含 tombstone。 */
export async function getNodeForMutation(id: string): Promise<Node | undefined> {
  return idbGet<Node>(STORE_NODES, id)
}

/** 按 id 输入顺序在同一 IndexedDB 事务读取活跃节点；未知或已删除节点保留为 undefined。 */
export async function getNodesRaw(ids: readonly string[]): Promise<Array<Node | undefined>> {
  const nodes = await idbGetMany<Node>(STORE_NODES, ids)
  return nodes.map((node) => (node?.deletedAt == null ? node : undefined))
}

// ---- AI fs.* 写 (§6.1): 跨 kind 写按 kind 分派到各 kind 专属 store。 ----
// content 用各 kind 的 Node content 形态 (note=Plate Value 数组; bookmark={url,description,favicon};
// feed={type,key,...})。thread 只供 FilesPort→FileSystem 的新会话动作内部创建，公开 fs.create
// 仍在兼容外观拒绝 thread/file。创建直接返回 Storage 事务实际提交的 Node。

/** fs.create: 按 kind 新建并返回 committed Node。file 不可经此创建 (需二进制上传)。 */
export async function createNode(input: FsCreateInput): Promise<Node> {
  switch (input.kind) {
    case "note": {
      return addNoteWithNode({
        title: input.title,
        content: Array.isArray(input.content) ? (input.content as unknown[]) : undefined,
        parentId: input.parentId ?? null,
        tags: input.tags,
      })
    }
    case "folder": {
      return addFolderWithNode(input.title ?? "")
    }
    case "bookmark": {
      const c = (input.content ?? {}) as { url?: string; description?: string; favicon?: string }
      if (typeof c.url !== "string" || !safeHref(c.url))
        throw new Error("bookmark 需合法 http(s) url")
      return addBookmarkWithNode({
        url: c.url,
        title: input.title || c.url,
        description: c.description,
        favicon: c.favicon,
        folderId: input.parentId ?? null,
        tags: input.tags,
      })
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
      return addSubscriptionWithNode({
        type: c.type,
        key: c.key,
        title: input.title || c.key,
        favicon: c.favicon,
        entityLabel: c.entityLabel,
        entityName: c.entityName,
        searchKeyword: c.searchKeyword,
        searchDomain: c.searchDomain,
      })
    }
    case "thread":
      return createThreadWithNode()
    case "file":
      throw new Error("file 不可经 fs.create 创建 (需二进制上传)")
    default:
      throw new Error(`未知 kind: ${input.kind}`)
  }
}

async function currentLiveMutationNode(
  kind: NodeKind,
  id: string,
  expected?: NodeMutationExpectation,
): Promise<Node | undefined> {
  const current = await getNodeForMutation(id)
  assertNodeMutationExpectation(current, expected)
  return current?.kind === kind && current.deletedAt == null ? current : undefined
}

/** fs.write: 按 kind 改节点，直接返回 Storage 事务实际提交的 Node。 */
export async function updateNode(
  kind: NodeKind,
  id: string,
  patch: FsWritePatch,
  expected?: NodeMutationExpectation,
): Promise<Node | undefined> {
  switch (kind) {
    case "note": {
      const notePatch = {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
        ...(Array.isArray(patch.content) ? { content: patch.content as unknown[] } : {}),
        ...(patch.parentId !== undefined ? { parentId: patch.parentId } : {}),
      }
      if (Object.keys(notePatch).length === 0) {
        return currentLiveMutationNode(kind, id, expected)
      }
      const updated = await updateNote(id, notePatch, expected)
      return updated ? ({ ...updated, kind: "note" } as Node) : undefined
    }
    case "bookmark": {
      const c = (patch.content ?? {}) as { url?: string; description?: string; favicon?: string }
      const bookmarkPatch = {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
        ...(typeof c.url === "string" ? { url: c.url } : {}),
        ...(typeof c.description === "string" ? { description: c.description } : {}),
        ...(typeof c.favicon === "string" ? { favicon: c.favicon } : {}),
        ...(patch.parentId !== undefined ? { folderId: patch.parentId } : {}),
      }
      if (Object.keys(bookmarkPatch).length === 0) {
        return currentLiveMutationNode(kind, id, expected)
      }
      return updateBookmark(id, bookmarkPatch, expected)
    }
    case "folder": {
      if (patch.parentId !== undefined && patch.parentId !== null) {
        throw new Error("收藏夹不能嵌套")
      }
      return patch.title !== undefined
        ? renameFolder(id, patch.title, expected)
        : currentLiveMutationNode(kind, id, expected)
    }
    case "file": {
      const filePatch = {
        ...(patch.title !== undefined ? { name: patch.title } : {}),
        ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
      }
      return Object.keys(filePatch).length > 0
        ? updateFileMeta(id, filePatch, expected)
        : currentLiveMutationNode(kind, id, expected)
    }
    case "thread": {
      const rawContent = patch.content as { messages?: unknown } | undefined
      const messages = rawContent?.messages
      if (messages !== undefined && !Array.isArray(messages)) {
        throw new Error("thread content.messages 必须是数组")
      }
      const title = patch.title?.trim()
      return updateThread(
        id,
        {
          ...(title ? { title } : {}),
          ...(Array.isArray(messages) ? { messages } : {}),
        },
        expected,
      )
    }
    default:
      return undefined // feed 无字段级更新 (关注由 add/remove 管理)
  }
}

/** fs.move: 改父 + 同级位置 (仅 note 树 / bookmark 归夹有意义; 余无操作)。 */
export async function moveNode(
  kind: NodeKind,
  id: string,
  parentId: string | null,
  afterSortKey?: string | null,
  expected?: NodeMutationExpectation,
): Promise<Node | undefined> {
  if (kind === "note") {
    const moved = await moveNote(
      id,
      parentId,
      afterSortKey === undefined ? undefined : { afterSortKey },
      expected,
    )
    return moved ? ({ ...moved, kind: "note" } as Node) : undefined
  } else if (kind === "bookmark") {
    const moved = await moveBookmark(
      id,
      parentId,
      afterSortKey === undefined ? undefined : { afterSortKey },
      expected,
    )
    return moved
  } else if (kind === "folder") {
    if (parentId !== null) throw new Error("收藏夹不能嵌套")
    return moveFolder(id, afterSortKey === undefined ? undefined : { afterSortKey }, expected)
  }
  return undefined
}

/** fs.delete: 按 kind 删 (note/bookmark/folder/file/thread 软删标记; feed 取消关注写删除标记)。 */
export async function deleteNode(
  kind: NodeKind,
  id: string,
  expected?: NodeMutationExpectation,
): Promise<boolean> {
  switch (kind) {
    case "note":
      return (await deleteNote(id, expected)).length > 0
    case "bookmark":
      return deleteBookmark(id, expected)
    case "folder":
      return deleteFolder(id, expected)
    case "file":
      return deleteFile(id, expected)
    case "thread":
      return deleteThread(id, expected)
    case "feed": {
      const current = await getNodeForMutation(id)
      assertNodeMutationExpectation(current, expected)
      if (!current || current.kind !== "feed" || current.deletedAt != null) return false
      return removeSubscription(current.content.type, current.content.key, expected)
    }
  }
}

/** 恢复节点；笔记删除是级联的，因此恢复同一棵仍处于回收站的子树。 */
export async function restoreNodeWithResult(
  kind: NodeKind,
  id: string,
  expected?: TrashMutationExpectation,
): Promise<Node | undefined> {
  let mutation = expected
  if (!mutation) {
    const current = await getNodeForMutation(id)
    if (!current || current.kind !== kind || current.deletedAt == null) return undefined
    const base = nodeMutationExpectation(current)
    mutation = { kind: base.kind, updatedAt: base.updatedAt, deletedAt: current.deletedAt }
  }
  if (mutation.kind !== kind) return undefined
  return kind === "note"
    ? restoreNoteTrashSubtreeWithRoot(id, mutation)
    : restoreTrashItemWithNode(id, mutation)
}

/** boolean 兼容包装；实际 committed root 由 restoreNodeWithResult 提供。 */
export async function restoreNode(
  kind: NodeKind,
  id: string,
  expected?: TrashMutationExpectation,
): Promise<boolean> {
  return Boolean(await restoreNodeWithResult(kind, id, expected))
}

/** fs.readBlob: 读文件二进制为 base64 (含 mime/size)。大文件拒读防 token 爆炸。 */
const BLOB_READ_CAP = 1024 * 1024 // 1MB
export async function readBlobBase64(
  id: string,
): Promise<{ mime: string; size: number; base64: string } | undefined> {
  const f = await getFile(id)
  if (!f) return undefined
  if (f.size > BLOB_READ_CAP) {
    return { mime: f.type, size: f.size, base64: "" } // 过大不内联, 仅回元数据
  }
  return {
    mime: f.type,
    size: f.size,
    base64: bytesToBase64(new Uint8Array(await f.blob.arrayBuffer())),
  }
}

/** UI/Engine 文件面读取原始 Blob；权限与范围限制由上层 FileSystem 执行。 */
export async function readBlob(id: string): Promise<Blob | undefined> {
  return (await getFile(id))?.blob
}
