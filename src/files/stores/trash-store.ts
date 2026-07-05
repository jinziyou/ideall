// 统一回收站 —— 读取 nodes 仓库中的 deletedAt 删除标记, 并用 trash_snapshots 保留本机可恢复快照。
// 同步仍以 nodes.deletedAt 传播删除; trash_snapshots 只服务本机恢复, 不进入同步/插件导出。
import type { Node, NodeKind, NodeOfKind } from "@protocol/node"
import { isLive } from "@protocol/sync"
import {
  idbBulkPut,
  idbCountFromIndex,
  idbDelete,
  idbGet,
  idbGetAll,
  idbGetAllFromIndex,
  idbPut,
  idbPutAcrossStores,
  INDEX_NODES_DELETED_AT,
  STORE_BLOBS,
  STORE_NODES,
  STORE_TRASH_SNAPSHOTS,
} from "@/lib/idb"
import { notifyFilesUpdated } from "@protocol/flowback"

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

function isTrashKind(kind: NodeKind): kind is TrashItem["kind"] {
  return ["folder", "note", "bookmark", "file", "feed", "thread"].includes(kind)
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
        detail: snapshot?.blob ? "可恢复文件内容" : "文件内容已清理, 只能永久删除记录",
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
  if (node.kind === "file") return Boolean(snapshot?.blob)
  return true
}

function reviveNode(node: Node): Node {
  const revived = { ...node, updatedAt: Date.now() } as Node
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
      const snapshot = snapshotById.get(node.id)
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
  return idbCountFromIndex(STORE_NODES, INDEX_NODES_DELETED_AT)
}

export async function restoreTrashItem(id: string): Promise<void> {
  const [node, snapshot] = await Promise.all([
    idbGet<Node>(STORE_NODES, id),
    idbGet<TrashSnapshot>(STORE_TRASH_SNAPSHOTS, id),
  ])
  if (!node || isLive(node) || !isTrashKind(node.kind)) return
  if (node.kind === "file") {
    if (!snapshot?.blob) throw new Error("文件内容快照不存在, 无法恢复")
    const base = snapshot.node.kind === "file" ? snapshot.node : node
    const revived = reviveNode(base) as NodeOfKind<"file">
    await idbPutAcrossStores([
      {
        store: STORE_BLOBS,
        value: { key: revived.blobRef.key, blob: snapshot.blob } satisfies BlobRecord,
      },
      { store: STORE_NODES, value: revived },
    ])
  } else {
    await idbPut(STORE_NODES, reviveNode(snapshot?.node ?? node))
  }
  await idbDelete(STORE_TRASH_SNAPSHOTS, id)
  notifyFilesUpdated()
}

export async function purgeTrashItem(id: string): Promise<void> {
  const node = await idbGet<Node>(STORE_NODES, id)
  if (node?.kind === "file") await idbDelete(STORE_BLOBS, node.blobRef.key)
  await Promise.all([idbDelete(STORE_NODES, id), idbDelete(STORE_TRASH_SNAPSHOTS, id)])
  notifyFilesUpdated()
}

export async function emptyTrash(): Promise<number> {
  const items = await listTrashItems()
  for (const item of items) {
    await purgeTrashItem(item.id)
  }
  return items.length
}
