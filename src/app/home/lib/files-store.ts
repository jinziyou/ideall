// 文件本地存储仓库 —— 折叠步 B 后物理统一到 nodes 仓库 (kind:"file") + Blob 旁存独立 blobs 仓库。
// 对外仍以 StoredFile / FileMeta 域类型呈现 (节点↔域类型投影在本仓库边界), 消费方零改:
//   - 文件节点: name→title, type/size→blobRef, 二进制拆到 blobs (blobRef.key = 文件 id), 不进同步;
//   - 删除走软删墓碑 (deletedAt) + 物理删 Blob (墓碑只留轻量节点, 大二进制不随墓碑常驻);
//     撤销 = 节点复活 + 从快照重放 Blob (restoreFile 入参 StoredFile 含 blob)。
// 本切片不开同步; sortKey/updatedAt 已补齐。Blob 大文件 E2E 同步属远期独立通道。
import { FileMeta, StoredFile } from "../model"
import type { NodeKind, NodeOfKind } from "@protocol/node"
import { genId } from "@/components/lib/id"
import { isLive } from "@protocol/sync"
import { sortKeyBetween } from "./sort-key"
import { planFilesSeed } from "./nodes-migrate"
import {
  idbBulkDelete,
  idbBulkPut,
  idbDelete,
  idbGet,
  idbGetAll,
  idbPutAcrossStores,
  idbReadModifyWrite,
  STORE_BLOBS,
  STORE_FILES,
  STORE_NODES,
} from "@/components/lib/idb"
import { notifyHubUpdated } from "./flowback"

type FileNode = NodeOfKind<"file">
type BlobRecord = { key: string; blob: Blob }

// ---- 节点 ↔ 域类型投影 ----

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

// ---- 懒迁移: 折叠步 B 续 —— 文件 (内联 Blob) 拆为节点 + 旁存 Blob ----

let seedPromise: Promise<void> | null = null

/** 折叠步 B 续懒迁移 (模块级 once): 旧 files 仓库 (内联 Blob) → nodes (blobRef) + blobs (二进制), 清空旧仓库。 */
export function seedFilesOnce(): Promise<void> {
  if (!seedPromise) {
    seedPromise = doSeedFiles().catch((e) => {
      seedPromise = null
      throw e
    })
  }
  return seedPromise
}

async function doSeedFiles(): Promise<void> {
  const [rawFiles, existingNodes] = await Promise.all([
    idbGetAll<Record<string, unknown>>(STORE_FILES),
    idbGetAll<{ id: string }>(STORE_NODES),
  ])
  const plan = planFilesSeed(rawFiles, new Set(existingNodes.map((n) => n.id)), Date.now())
  if (!plan) return
  // 先写 blob + 节点, 再清旧仓库; 顺序保证不丢 (blob/node 落地后才删内联源)。
  if (plan.blobPuts.length) await idbBulkPut(STORE_BLOBS, plan.blobPuts)
  if (plan.nodePuts.length) await idbBulkPut(STORE_NODES, plan.nodePuts)
  if (plan.drainFileIds.length) await idbBulkDelete(STORE_FILES, plan.drainFileIds)
}

// ---- nodes 仓库内 kind 作用域读 + sortKey 追加 ----

async function allFileNodes(): Promise<FileNode[]> {
  const all = await idbGetAll<{ id: string; kind?: NodeKind }>(STORE_NODES)
  return all.filter((n): n is FileNode => n.kind === "file")
}

/** 同级最大 sortKey (含墓碑)。 */
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
  await seedFilesOnce()
  const files = (await allFileNodes()).filter(isLive).map(nodeToMeta)
  return files.sort((a, b) => b.createdAt - a.createdAt)
}

/** 活跃文件数 (过滤墓碑) —— 数量徽标用。 */
export async function countFiles(): Promise<number> {
  await seedFilesOnce()
  return (await allFileNodes()).filter(isLive).length
}

/** 读取单个完整文件 (含 Blob); 墓碑 / 非文件 kind / Blob 缺失视为不存在。 */
export async function getFile(id: string): Promise<StoredFile | undefined> {
  await seedFilesOnce()
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
  await seedFilesOnce()
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
  notifyHubUpdated()
  return nodeToMeta(node)
}

/** 更新文件元数据 (重命名 / 改标签); 不改动 Blob */
export async function updateFileMeta(
  id: string,
  patch: Partial<Pick<StoredFile, "name" | "tags">>,
): Promise<void> {
  await seedFilesOnce()
  // 单事务读-改-写; kind 守卫防误改其它 kind 节点。name→title 投影。
  await idbReadModifyWrite<FileNode>(STORE_NODES, id, (current) => {
    if (!current || current.kind !== "file") return undefined
    const next: FileNode = { ...current, updatedAt: Date.now() }
    if (patch.name !== undefined) next.title = patch.name
    if (patch.tags !== undefined) next.tags = patch.tags
    return next
  })
  // 与 add/delete 一致: 通知中枢回流, 否则 keep-alive 的概览时间线在改名后会陈旧。
  notifyHubUpdated()
}

/** 删除文件 (软删墓碑 + 物理删 Blob; 撤销靠 restoreFile 从快照重放)。 */
export async function deleteFile(id: string): Promise<void> {
  await seedFilesOnce()
  const now = Date.now()
  // 先墓碑节点 (隐藏该文件), 再删大 Blob (墓碑只留轻量节点)。
  const tomb = await idbReadModifyWrite<FileNode>(STORE_NODES, id, (current) =>
    current && current.kind === "file" ? { ...current, deletedAt: now, updatedAt: now } : undefined,
  )
  if (tomb) await idbDelete(STORE_BLOBS, tomb.blobRef.key)
  notifyHubUpdated()
}

/** 撤销删除: 把刚删除的文件 (含 Blob) 复活 (重放 Blob + 节点清墓碑, 保留 id/createdAt)。 */
export async function restoreFile(file: StoredFile): Promise<void> {
  await seedFilesOnce()
  const now = Date.now()
  const existing = await allFileNodes()
  // 软删后墓碑节点仍在 → 复用其 sortKey/parentId 复活; 极端兜底 (节点不存在) 用追加键重建。
  const tomb = existing.find((n) => n.id === file.id)
  const revived: FileNode = {
    id: file.id,
    kind: "file",
    title: file.name,
    parentId: tomb?.parentId ?? null,
    sortKey: tomb?.sortKey || nextKey(maxKey(existing)),
    tags: file.tags,
    createdAt: file.createdAt,
    updatedAt: now,
    blobRef: { store: "blobs", key: file.id, size: file.size, mime: file.type },
    content: null,
  }
  // Blob 与节点同一事务原子写 (撤销=同生): 与 addFile 一致, 不留孤儿 Blob; 原 restoreFile 本就是直接 put 非 RMW。
  await idbPutAcrossStores([
    { store: STORE_BLOBS, value: { key: file.id, blob: file.blob } satisfies BlobRecord },
    { store: STORE_NODES, value: revived },
  ])
  notifyHubUpdated()
}
