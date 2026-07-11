// 文件本地存储仓库 —— 折叠步 B 后物理统一到 nodes 仓库 (kind:"file") + Blob 旁存独立 blobs 仓库。
// 对外仍以 StoredFile / FileMeta 域类型呈现 (节点↔域类型映射在本仓库边界), 消费方零改:
//   - 文件节点: name→title, type/size→blobRef, 二进制拆到 blobs (blobRef.key = 文件 id), 不进同步;
//   - 删除走软删标记 (deletedAt) + 物理删 Blob (删除标记只留轻量节点, 大二进制不随删除标记常驻);
//     撤销 = 节点恢复 + 从快照重放 Blob (restoreFile 入参 StoredFile 含 blob)。
// 本切片不开同步; sortKey/updatedAt 已补齐。Blob 大文件 E2E 同步属远期独立通道。
import { FileMeta, StoredFile } from "@protocol/files"
import type { NodeKind, NodeOfKind } from "@protocol/node"
import { genId } from "@/lib/id"
import { isLive } from "@protocol/sync"
import { sortKeyBetween } from "@/files/sort-key"
import {
  idbDelete,
  idbGet,
  idbGetAllFromIndex,
  idbPutAcrossStores,
  idbReadModifyWrite,
  INDEX_NODES_KIND,
  STORE_BLOBS,
  STORE_NODES,
} from "@/lib/idb"
import { notifyFilesUpdated } from "@protocol/flowback"
import { captureTrashSnapshot } from "@/files/stores/trash-store"
import { nextUpdatedAt } from "@/files/version"

type FileNode = NodeOfKind<"file">
type BlobRecord = { key: string; blob: Blob }

// ---- 节点 ↔ 域类型映射 ----

function nodeToMeta(n: FileNode): FileMeta {
  return {
    id: n.id,
    name: n.title,
    type: n.blobRef.mime,
    size: n.blobRef.size,
    createdAt: n.createdAt,
    tags: n.tags,
  }
}

// ---- nodes 仓库内 kind 作用域读 + sortKey 追加 ----

async function allFileNodes(): Promise<FileNode[]> {
  const all = await idbGetAllFromIndex<{ id: string; kind?: NodeKind }>(
    STORE_NODES,
    INDEX_NODES_KIND,
    "file",
  )
  return all.filter((n): n is FileNode => n.kind === "file")
}

/** 同级最大 sortKey (含删除标记)。 */
function maxKey(nodes: { sortKey: string }[]): string | null {
  const keys = nodes
    .map((n) => n.sortKey)
    .filter((k) => typeof k === "string" && k.length > 0)
    .sort()
  return keys.length ? keys[keys.length - 1] : null
}

/** 自 after 起生成一个严格递增键 (文件列表按 createdAt 展示, sortKey 仅供就绪)。 */
function nextKey(after: string | null): string {
  try {
    return sortKeyBetween(after, null)
  } catch {
    return sortKeyBetween(null, null)
  }
}

// ---- 读 ----

/** 列出所有文件元数据 (不含 Blob), 按创建时间倒序 */
export async function listFiles(): Promise<FileMeta[]> {
  const files = (await allFileNodes()).filter(isLive).map(nodeToMeta)
  return files.sort((a, b) => b.createdAt - a.createdAt)
}

/** 读取单个完整文件 (含 Blob); 删除标记 / 非文件 kind / Blob 缺失视为不存在。 */
export async function getFile(id: string): Promise<StoredFile | undefined> {
  const node = await idbGet<FileNode>(STORE_NODES, id)
  if (!node || node.kind !== "file" || !isLive(node)) return undefined
  const rec = await idbGet<BlobRecord>(STORE_BLOBS, node.blobRef.key)
  if (!rec) return undefined
  return {
    id: node.id,
    name: node.title,
    type: node.blobRef.mime,
    size: node.blobRef.size,
    blob: rec.blob,
    createdAt: node.createdAt,
    tags: node.tags,
  }
}

// ---- 写 ----

/** 保存一个浏览器 File 对象, 返回元数据 */
export async function addFile(file: File, tags: string[] = []): Promise<FileMeta> {
  const existing = await allFileNodes()
  const now = Date.now()
  const id = genId("f")
  const node: FileNode = {
    id,
    kind: "file",
    title: file.name,
    parentId: null,
    sortKey: nextKey(maxKey(existing)),
    tags,
    createdAt: now,
    updatedAt: now,
    blobRef: { store: "blobs", key: id, size: file.size, mime: file.type },
    content: null,
  }
  // Blob 与节点同一事务原子写: 避免「Blob 已落、节点写入中断」留下无引用孤儿 Blob (无 GC 路径)。
  await idbPutAcrossStores([
    { store: STORE_BLOBS, value: { key: id, blob: file } satisfies BlobRecord },
    { store: STORE_NODES, value: node },
  ])
  notifyFilesUpdated({ kind: "file", id })
  return nodeToMeta(node)
}

/** 更新文件元数据 (重命名 / 改标签); 不改动 Blob */
export async function updateFileMeta(
  id: string,
  patch: Partial<Pick<StoredFile, "name" | "tags">>,
): Promise<void> {
  // 单事务读-改-写; kind 守卫防误改其它 kind 节点。name→title 映射。
  await idbReadModifyWrite<FileNode>(STORE_NODES, id, (current) => {
    if (!current || current.kind !== "file") return undefined
    const next: FileNode = { ...current, updatedAt: nextUpdatedAt(current.updatedAt) }
    if (patch.name !== undefined) next.title = patch.name
    if (patch.tags !== undefined) next.tags = patch.tags
    return next
  })
  // 与 add/delete 一致: 通知「我的」更新, 否则 keep-alive 的概览时间线在改名后会陈旧。
  notifyFilesUpdated({ kind: "file", id })
}

/** 更新文本/代码类文件内容: Blob 与文件节点元数据同事务写回。 */
export async function updateFileContent(
  id: string,
  content: string,
  mime?: string,
): Promise<StoredFile | undefined> {
  const current = await idbGet<FileNode>(STORE_NODES, id)
  if (!current || current.kind !== "file" || !isLive(current)) return undefined
  const blob = new Blob([content], { type: mime || current.blobRef.mime || "text/plain" })
  const now = nextUpdatedAt(current.updatedAt)
  const next: FileNode = {
    ...current,
    updatedAt: now,
    blobRef: {
      ...current.blobRef,
      size: blob.size,
      mime: blob.type || current.blobRef.mime,
    },
  }
  await idbPutAcrossStores([
    { store: STORE_BLOBS, value: { key: current.blobRef.key, blob } satisfies BlobRecord },
    { store: STORE_NODES, value: next },
  ])
  notifyFilesUpdated({ kind: "file", id })
  return {
    id: next.id,
    name: next.title,
    type: next.blobRef.mime,
    size: next.blobRef.size,
    blob,
    createdAt: next.createdAt,
    tags: next.tags,
  }
}

/** 删除文件 (软删标记 + 物理删 Blob; 撤销靠 restoreFile 从快照重放)。 */
export async function deleteFile(id: string): Promise<void> {
  const now = Date.now()
  const current = await idbGet<FileNode>(STORE_NODES, id)
  if (current && current.kind === "file" && isLive(current)) {
    const rec = await idbGet<BlobRecord>(STORE_BLOBS, current.blobRef.key)
    if (rec) await captureTrashSnapshot(current, rec.blob)
  }
  // 先给节点打删除标记 (隐藏该文件), 再删大 Blob (删除标记只留轻量节点)。
  const tomb = await idbReadModifyWrite<FileNode>(STORE_NODES, id, (current) =>
    current && current.kind === "file"
      ? { ...current, deletedAt: now, updatedAt: nextUpdatedAt(current.updatedAt, now) }
      : undefined,
  )
  if (tomb) await idbDelete(STORE_BLOBS, tomb.blobRef.key)
  notifyFilesUpdated({ kind: "file", id })
}

/** 撤销删除: 把刚删除的文件 (含 Blob) 恢复 (重放 Blob + 节点清删除标记, 保留 id/createdAt)。 */
export async function restoreFile(file: StoredFile): Promise<void> {
  const now = Date.now()
  const existing = await allFileNodes()
  // 软删后删除标记节点仍在 → 复用其 sortKey/parentId 恢复; 极端兜底 (节点不存在) 用追加键重建。
  const tomb = existing.find((n) => n.id === file.id)
  const revived: FileNode = {
    id: file.id,
    kind: "file",
    title: file.name,
    parentId: tomb?.parentId ?? null,
    sortKey: tomb?.sortKey || nextKey(maxKey(existing)),
    tags: file.tags,
    createdAt: file.createdAt,
    updatedAt: tomb ? nextUpdatedAt(tomb.updatedAt, now) : now,
    blobRef: { store: "blobs", key: file.id, size: file.size, mime: file.type },
    content: null,
  }
  // Blob 与节点同一事务原子写 (撤销=同生): 与 addFile 一致, 不留孤儿 Blob; 原 restoreFile 本就是直接 put 非 RMW。
  await idbPutAcrossStores([
    { store: STORE_BLOBS, value: { key: file.id, blob: file.blob } satisfies BlobRecord },
    { store: STORE_NODES, value: revived },
  ])
  notifyFilesUpdated({ kind: "file", id: file.id })
}
