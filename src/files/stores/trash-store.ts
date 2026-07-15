// 统一回收站 —— 读取 nodes 仓库中的 deletedAt 删除标记, 并用 trash_snapshots 保留本机可恢复快照。
// 同步仍以 nodes.deletedAt 传播删除; trash_snapshots 只服务本机恢复, 不进入同步/插件导出。
import type { Node, NodeKind, NodeOfKind } from "@protocol/node"
import { isLive } from "@protocol/sync"
import {
  idbBulkPut,
  idbDeleteAcrossStoresIf,
  idbGetAll,
  idbGetAllFromIndex,
  idbPut,
  idbRunTransaction,
  INDEX_NODES_DELETED_AT,
  INDEX_NODES_KIND,
  STORE_BLOBS,
  STORE_NODES,
  STORE_TRASH_SNAPSHOTS,
} from "@/lib/idb"
import { notifyFilesUpdated } from "@protocol/flowback"
import { nextUpdatedAt } from "@/files/version"
import { buildParentOf, effectiveParentId } from "@/files/notes-tree-util"

type BlobRecord = { key: string; blob: Blob }

export type TrashSnapshot = {
  id: string
  node: Node
  blob?: Blob
  capturedAt: number
}

export type TrashItem = {
  id: string
  kind: NodeKind
  title: string
  deletedAt: number
  updatedAt: number
  parentId: string | null
  tags: string[]
  restorable: boolean
  snapshot: boolean
  detail: string
  size?: number
  mime?: string
}

export type TrashMutationExpectation = Pick<TrashItem, "kind" | "updatedAt" | "deletedAt">
export type TrashCollectionExpectation = TrashMutationExpectation & Pick<TrashItem, "id">

function matchesExpectation(node: Node, expected?: TrashMutationExpectation): boolean {
  return (
    expected === undefined ||
    (node.kind === expected.kind &&
      node.updatedAt === expected.updatedAt &&
      node.deletedAt === expected.deletedAt)
  )
}

function isTrashKind(kind: NodeKind): kind is TrashItem["kind"] {
  return ["folder", "note", "bookmark", "file", "feed", "thread"].includes(kind)
}

function validSnapshotForNode(
  node: Node,
  snapshot: TrashSnapshot | undefined,
): TrashSnapshot | undefined {
  return snapshot?.id === node.id &&
    snapshot.node.id === node.id &&
    snapshot.node.kind === node.kind
    ? snapshot
    : undefined
}

function trashDetail(
  node: Node,
  snapshot?: TrashSnapshot,
): Pick<TrashItem, "detail" | "size" | "mime"> {
  switch (node.kind) {
    case "note":
      return {
        detail: snapshot ? "可恢复正文快照" : "仅剩同步删除标记, 恢复后正文为空",
      }
    case "bookmark":
      return { detail: node.content.url || "书签" }
    case "folder":
      return { detail: "收藏夹" }
    case "file":
      return {
        detail:
          snapshot?.blob instanceof Blob ? "可恢复文件内容" : "文件内容已清理, 只能永久删除记录",
        size: node.blobRef.size,
        mime: node.blobRef.mime,
      }
    case "feed":
      return { detail: `${node.content.type}:${node.content.key}` }
    case "thread":
      return { detail: "对话线程" }
  }
}

function canRestore(node: Node, snapshot?: TrashSnapshot): boolean {
  if (!isTrashKind(node.kind)) return false
  if (node.kind === "file") return snapshot?.blob instanceof Blob
  return true
}

function reviveNode(node: Node, previousUpdatedAt: number): Node {
  const revived = {
    ...node,
    updatedAt: nextUpdatedAt(Math.max(node.updatedAt, previousUpdatedAt)),
  } as Node
  delete revived.deletedAt
  return revived
}

export async function captureTrashSnapshot(node: Node, blob?: Blob): Promise<void> {
  await idbPut(STORE_TRASH_SNAPSHOTS, {
    id: node.id,
    node,
    blob,
    capturedAt: Date.now(),
  } satisfies TrashSnapshot)
}

export async function captureTrashSnapshots(nodes: Node[]): Promise<void> {
  if (!nodes.length) return
  const now = Date.now()
  await idbBulkPut(
    STORE_TRASH_SNAPSHOTS,
    nodes.map((node) => ({ id: node.id, node, capturedAt: now }) satisfies TrashSnapshot),
  )
}

export async function listTrashItems(): Promise<TrashItem[]> {
  const [nodes, snapshots] = await Promise.all([
    idbGetAllFromIndex<Node>(STORE_NODES, INDEX_NODES_DELETED_AT),
    idbGetAll<TrashSnapshot>(STORE_TRASH_SNAPSHOTS),
  ])
  const snapshotById = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]))
  const deleted = nodes.filter(
    (node): node is Extract<Node, { kind: TrashItem["kind"] }> & { deletedAt: number } =>
      node.deletedAt != null && isTrashKind(node.kind),
  )
  return deleted
    .map((node) => {
      const snapshot = validSnapshotForNode(node, snapshotById.get(node.id))
      const detail = trashDetail(node, snapshot)
      return {
        id: node.id,
        kind: node.kind,
        title: node.title || "无标题",
        deletedAt: node.deletedAt ?? node.updatedAt,
        updatedAt: node.updatedAt,
        parentId: node.parentId,
        tags: node.tags,
        restorable: canRestore(node, snapshot),
        snapshot: Boolean(snapshot),
        ...detail,
      }
    })
    .sort((a, b) => b.deletedAt - a.deletedAt)
}

export async function countTrashItems(): Promise<number> {
  const nodes = await idbGetAllFromIndex<Node>(STORE_NODES, INDEX_NODES_DELETED_AT)
  return nodes.filter((node) => node.deletedAt != null && isTrashKind(node.kind)).length
}

/** 恢复单个回收站节点，并返回本次事务实际提交的 live Node。 */
export async function restoreTrashItemWithNode(
  id: string,
  expected?: TrashMutationExpectation,
): Promise<Node | undefined> {
  const restored = await idbRunTransaction<Node | undefined>(
    [STORE_NODES, STORE_BLOBS, STORE_TRASH_SNAPSHOTS],
    "readwrite",
    (transaction, setResult, abort) => {
      const nodeStore = transaction.objectStore(STORE_NODES)
      const blobStore = transaction.objectStore(STORE_BLOBS)
      const trashStore = transaction.objectStore(STORE_TRASH_SNAPSHOTS)
      const nodeRequest = nodeStore.get(id)
      nodeRequest.onerror = () => abort(nodeRequest.error ?? new Error("读取待恢复节点失败"))
      nodeRequest.onsuccess = () => {
        try {
          const current = nodeRequest.result as Node | undefined
          if (
            !current ||
            isLive(current) ||
            !isTrashKind(current.kind) ||
            !matchesExpectation(current, expected)
          ) {
            setResult(undefined)
            return
          }
          const snapshotRequest = trashStore.get(id)
          snapshotRequest.onerror = () =>
            abort(snapshotRequest.error ?? new Error("读取回收站快照失败"))
          snapshotRequest.onsuccess = () => {
            try {
              const snapshot = snapshotRequest.result as TrashSnapshot | undefined
              const snapshotMatches =
                snapshot?.id === id &&
                snapshot.node.id === id &&
                snapshot.node.kind === current.kind
              const base = snapshotMatches ? snapshot.node : current

              const write = (parentId: string | null) => {
                const revived = reviveNode({ ...base, parentId } as Node, current.updatedAt)
                if (current.kind === "file") {
                  if (
                    !snapshotMatches ||
                    snapshot?.node.kind !== "file" ||
                    !(snapshot.blob instanceof Blob)
                  ) {
                    throw new Error("文件内容快照不存在或不匹配, 无法恢复")
                  }
                  const file = revived as NodeOfKind<"file">
                  if (file.blobRef.store !== "blobs" || !file.blobRef.key) {
                    throw new Error("文件内容快照引用无效, 无法恢复")
                  }
                  blobStore.put({
                    key: file.blobRef.key,
                    blob: snapshot.blob,
                  } satisfies BlobRecord)
                }
                nodeStore.put(revived)
                trashStore.delete(id)
                setResult(revived)
              }

              if (current.kind === "bookmark" && base.parentId !== null) {
                const folderRequest = nodeStore.get(base.parentId)
                folderRequest.onerror = () =>
                  abort(folderRequest.error ?? new Error("读取书签恢复目标收藏夹失败"))
                folderRequest.onsuccess = () => {
                  try {
                    const folder = folderRequest.result as Node | undefined
                    write(folder?.kind === "folder" && isLive(folder) ? folder.id : null)
                  } catch (error) {
                    abort(error)
                  }
                }
                return
              }

              if (current.kind === "note" && base.parentId !== null) {
                const directParentId = base.parentId
                const seen = new Set<string>([id])
                const validateParentChain = (parentId: string) => {
                  if (seen.has(parentId)) {
                    write(null)
                    return
                  }
                  seen.add(parentId)
                  const parentRequest = nodeStore.get(parentId)
                  parentRequest.onerror = () =>
                    abort(parentRequest.error ?? new Error("读取笔记恢复目标父页面失败"))
                  parentRequest.onsuccess = () => {
                    try {
                      const parent = parentRequest.result as Node | undefined
                      if (!parent || parent.kind !== "note" || !isLive(parent)) {
                        write(null)
                        return
                      }
                      if (parent.parentId === null) {
                        write(directParentId)
                        return
                      }
                      validateParentChain(parent.parentId)
                    } catch (error) {
                      abort(error)
                    }
                  }
                }
                validateParentChain(directParentId)
                return
              }

              // folder/file/feed/thread 都是根级节点；损坏快照不能借恢复制造嵌套结构。
              write(current.kind === "note" || current.kind === "bookmark" ? base.parentId : null)
            } catch (error) {
              abort(error)
            }
          }
        } catch (error) {
          abort(error)
        }
      }
    },
  )
  if (restored) notifyFilesUpdated({ kind: restored.kind, id: restored.id })
  return restored
}

/** boolean 兼容包装；通知由 committed-node API 统一发出。 */
export async function restoreTrashItem(
  id: string,
  expected?: TrashMutationExpectation,
): Promise<boolean> {
  return Boolean(await restoreTrashItemWithNode(id, expected))
}

/** 笔记级联删除的逆操作：整棵仍删除的子树、正文快照与父级修复一次提交。 */
export async function restoreNoteTrashSubtreeWithRoot(
  rootId: string,
  expected?: TrashMutationExpectation,
): Promise<NodeOfKind<"note"> | undefined> {
  const restoredRoot = await idbRunTransaction<NodeOfKind<"note"> | undefined>(
    [STORE_NODES, STORE_TRASH_SNAPSHOTS],
    "readwrite",
    (transaction, setResult, abort) => {
      const nodeStore = transaction.objectStore(STORE_NODES)
      const trashStore = transaction.objectStore(STORE_TRASH_SNAPSHOTS)
      const request = nodeStore.index(INDEX_NODES_KIND).getAll("note")
      request.onerror = () => abort(request.error ?? new Error("读取待恢复笔记子树失败"))
      request.onsuccess = () => {
        try {
          const all = (request.result as Node[]).filter(
            (node): node is NodeOfKind<"note"> => node.kind === "note",
          )
          const deleted = all.filter((node) => !isLive(node))
          const root = deleted.find((node) => node.id === rootId)
          if (!root || !matchesExpectation(root, expected)) {
            setResult(undefined)
            return
          }

          const children = new Map<string, NodeOfKind<"note">[]>()
          for (const node of deleted) {
            if (node.parentId === null) continue
            const values = children.get(node.parentId) ?? []
            values.push(node)
            children.set(node.parentId, values)
          }
          const subtree: NodeOfKind<"note">[] = []
          const queue = [root]
          const seen = new Set<string>()
          while (queue.length > 0) {
            const current = queue.shift() as NodeOfKind<"note">
            if (seen.has(current.id)) continue
            seen.add(current.id)
            subtree.push(current)
            queue.push(...(children.get(current.id) ?? []))
          }

          const snapshotById = new Map<string, NodeOfKind<"note">>()
          let remaining = subtree.length
          const commit = () => {
            const subtreeIds = new Set(subtree.map((node) => node.id))
            const bases = subtree.map((current) => snapshotById.get(current.id) ?? current)
            const candidates = [
              ...all.filter((node) => isLive(node) && !subtreeIds.has(node.id)),
              ...bases,
            ]
            const parentOf = buildParentOf(candidates)
            let revivedRoot: NodeOfKind<"note"> | undefined
            for (const current of subtree) {
              const base = snapshotById.get(current.id) ?? current
              const parentId = effectiveParentId(base.id, base.parentId, parentOf)
              const revived = reviveNode(
                { ...base, parentId },
                current.updatedAt,
              ) as NodeOfKind<"note">
              nodeStore.put(revived)
              trashStore.delete(current.id)
              if (current.id === rootId) revivedRoot = revived
            }
            if (!revivedRoot) throw new Error("恢复笔记子树时未找到根节点")
            setResult(revivedRoot)
          }

          for (const current of subtree) {
            const snapshotRequest = trashStore.get(current.id)
            snapshotRequest.onerror = () =>
              abort(snapshotRequest.error ?? new Error("读取笔记回收站快照失败"))
            snapshotRequest.onsuccess = () => {
              try {
                const snapshot = snapshotRequest.result as TrashSnapshot | undefined
                if (
                  snapshot?.id === current.id &&
                  snapshot.node.id === current.id &&
                  snapshot.node.kind === "note"
                ) {
                  snapshotById.set(current.id, snapshot.node)
                }
                remaining -= 1
                if (remaining === 0) commit()
              } catch (error) {
                abort(error)
              }
            }
          }
        } catch (error) {
          abort(error)
        }
      }
    },
  )
  // 子树可能同时恢复多个精确资源；一次 kind 级事件让集合和任意子节 watcher 同步刷新。
  if (restoredRoot) notifyFilesUpdated({ kind: "note" })
  return restoredRoot
}

/** boolean 兼容包装；通知由 committed-root API 统一发出。 */
export async function restoreNoteTrashSubtree(
  rootId: string,
  expected?: TrashMutationExpectation,
): Promise<boolean> {
  return Boolean(await restoreNoteTrashSubtreeWithRoot(rootId, expected))
}

export async function purgeTrashItem(
  id: string,
  expected?: TrashMutationExpectation,
): Promise<boolean> {
  const node = await purgeTrashItemWithoutNotify(id, expected)
  if (node) notifyFilesUpdated({ kind: node.kind, id })
  return Boolean(node)
}

export async function emptyTrash(
  expected?: readonly TrashCollectionExpectation[],
): Promise<number | null> {
  const deleted = await idbRunTransaction<number | null>(
    [STORE_NODES, STORE_BLOBS, STORE_TRASH_SNAPSHOTS],
    "readwrite",
    (transaction, setResult, abort) => {
      const nodeStore = transaction.objectStore(STORE_NODES)
      const blobStore = transaction.objectStore(STORE_BLOBS)
      const trashStore = transaction.objectStore(STORE_TRASH_SNAPSHOTS)
      const request = nodeStore.index(INDEX_NODES_DELETED_AT).getAll()
      request.onerror = () => abort(request.error ?? new Error("读取待清空回收站失败"))
      request.onsuccess = () => {
        try {
          const nodes = (request.result as Node[]).filter(
            (node) => node.deletedAt != null && isTrashKind(node.kind),
          )
          if (expected !== undefined) {
            const byId = new Map(expected.map((item) => [item.id, item]))
            const matches =
              byId.size === expected.length &&
              nodes.length === expected.length &&
              nodes.every((node) => {
                const item = byId.get(node.id)
                return item !== undefined && matchesExpectation(node, item)
              })
            if (!matches) {
              setResult(null)
              return
            }
          }
          for (const node of nodes) {
            if (node.kind === "file") blobStore.delete(node.blobRef.key)
            nodeStore.delete(node.id)
            trashStore.delete(node.id)
          }
          setResult(nodes.length)
        } catch (error) {
          abort(error)
        }
      }
    },
  )
  if (deleted != null && deleted > 0) notifyFilesUpdated()
  return deleted
}

async function purgeTrashItemWithoutNotify(
  id: string,
  expected?: TrashMutationExpectation,
): Promise<Node | undefined> {
  return idbDeleteAcrossStoresIf<Node>(
    [STORE_BLOBS, STORE_TRASH_SNAPSHOTS],
    STORE_NODES,
    id,
    (node) => node.deletedAt != null && matchesExpectation(node, expected),
    (node) => [
      { store: STORE_TRASH_SNAPSHOTS, key: id },
      ...(node.kind === "file" ? [{ store: STORE_BLOBS, key: node.blobRef.key }] : []),
    ],
  )
}
