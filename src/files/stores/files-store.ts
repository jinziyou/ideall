// 文件本地存储仓库 —— 折叠步 B 后物理统一到 nodes 仓库 (kind:"file") + Blob 旁存独立 blobs 仓库。
// 对外仍以 StoredFile / FileMeta 域类型呈现 (节点↔域类型映射在本仓库边界), 消费方零改:
//   - 文件节点: name→title, type/size→blobRef, 二进制拆到 blobs (blobRef.key = 文件 id), 不进同步;
//   - 删除走软删标记 (deletedAt) + 物理删 Blob (删除标记只留轻量节点, 大二进制不随删除标记常驻);
//     撤销 = 节点恢复 + 从快照重放 Blob (restoreFile 入参 StoredFile 含 blob)。
// 本切片不开同步; sortKey/updatedAt 已补齐。Blob 大文件 E2E 同步属远期独立通道。
import { FileMeta, StoredFile } from "@protocol/files"
import type { Node, NodeKind, NodeOfKind } from "@protocol/node"
import { genId } from "@/lib/id"
import { isLive } from "@protocol/sync"
import {
  idbGet,
  idbGetAllFromIndex,
  idbReadModifyWrite,
  idbRunTransaction,
  INDEX_NODES_KIND,
  STORE_BLOBS,
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

/** 保存浏览器 File，并返回 Blob + Node 同一写事务实际提交的统一 Node。 */
export async function addFileWithNode(file: File, tags: string[] = []): Promise<FileNode> {
  const now = Date.now()
  const id = genId("f")
  // 尾键读取、Blob 与节点写入同一事务：既防并发排序键碰撞，也不留下无引用 Blob。
  const node = await idbRunTransaction<FileNode>(
    [STORE_BLOBS, STORE_NODES],
    "readwrite",
    (transaction, setResult, abort) => {
      const blobStore = transaction.objectStore(STORE_BLOBS)
      addNodeAtKindTail(
        transaction.objectStore(STORE_NODES),
        { kind: "file", parentId: null },
        (sortKey) => ({
          id,
          kind: "file",
          title: file.name,
          parentId: null,
          sortKey,
          tags,
          createdAt: now,
          updatedAt: now,
          blobRef: { store: "blobs", key: id, size: file.size, mime: file.type },
          content: null,
        }),
        (created) => {
          blobStore.put({ key: id, blob: file } satisfies BlobRecord)
          setResult(created)
        },
        abort,
      )
    },
  )
  notifyFilesUpdated({ kind: "file", id })
  return node
}

/** 兼容既有 FilesPort DTO；创建真相由 addFileWithNode 返回。 */
export async function addFile(file: File, tags: string[] = []): Promise<FileMeta> {
  return nodeToMeta(await addFileWithNode(file, tags))
}

/** 更新文件元数据 (重命名 / 改标签); 不改动 Blob */
export async function updateFileMeta(
  id: string,
  patch: Partial<Pick<StoredFile, "name" | "tags">>,
  expected?: NodeMutationExpectation,
): Promise<FileNode | undefined> {
  if (patch.name === undefined && patch.tags === undefined) return undefined
  // 单事务读-改-写; kind 守卫防误改其它 kind 节点。name→title 映射。
  const updated = await idbReadModifyWrite<FileNode>(STORE_NODES, id, (current) => {
    assertNodeMutationExpectation(current, expected)
    if (!current || current.kind !== "file" || !isLive(current)) return undefined
    const next: FileNode = { ...current, updatedAt: nextUpdatedAt(current.updatedAt) }
    if (patch.name !== undefined) next.title = patch.name
    if (patch.tags !== undefined) next.tags = patch.tags
    return next
  })
  // 与 add/delete 一致: 通知「我的」更新, 否则 keep-alive 的概览时间线在改名后会陈旧。
  if (updated) notifyFilesUpdated({ kind: "file", id })
  return updated
}

/** 更新文本/代码类文件内容: Blob 与文件节点元数据同事务写回。 */
export async function updateFileContent(
  id: string,
  content: string,
  mime?: string,
  expected?: NodeMutationExpectation,
): Promise<FileNode | undefined> {
  const updated = await idbRunTransaction<FileNode | undefined>(
    [STORE_BLOBS, STORE_NODES],
    "readwrite",
    (transaction, setResult, abort) => {
      const blobStore = transaction.objectStore(STORE_BLOBS)
      const nodeStore = transaction.objectStore(STORE_NODES)
      const request = nodeStore.get(id)
      request.onerror = () => abort(request.error ?? new Error("读取待更新文件失败"))
      request.onsuccess = () => {
        try {
          const current = request.result as Node | undefined
          assertNodeMutationExpectation(current, expected)
          if (!current || current.kind !== "file" || !isLive(current)) {
            setResult(undefined)
            return
          }
          const blob = new Blob([content], {
            type: mime || current.blobRef.mime || "text/plain",
          })
          const next: FileNode = {
            ...current,
            updatedAt: nextUpdatedAt(current.updatedAt),
            blobRef: {
              ...current.blobRef,
              size: blob.size,
              mime: blob.type || current.blobRef.mime,
            },
          }
          blobStore.put({ key: current.blobRef.key, blob } satisfies BlobRecord)
          nodeStore.put(next)
          setResult(next)
        } catch (error) {
          abort(error)
        }
      }
    },
  )
  if (!updated) return undefined
  notifyFilesUpdated({ kind: "file", id })
  return updated
}

/** 删除文件 (软删标记 + 物理删 Blob; 撤销靠 restoreFile 从快照重放)。 */
export async function deleteFile(id: string, expected?: NodeMutationExpectation): Promise<boolean> {
  const deleted = await idbRunTransaction<boolean>(
    [STORE_BLOBS, STORE_NODES, STORE_TRASH_SNAPSHOTS],
    "readwrite",
    (transaction, setResult, abort) => {
      const blobStore = transaction.objectStore(STORE_BLOBS)
      const nodeStore = transaction.objectStore(STORE_NODES)
      const trashStore = transaction.objectStore(STORE_TRASH_SNAPSHOTS)
      const nodeRequest = nodeStore.get(id)
      nodeRequest.onerror = () => abort(nodeRequest.error ?? new Error("读取待删除文件失败"))
      nodeRequest.onsuccess = () => {
        try {
          const current = nodeRequest.result as Node | undefined
          assertNodeMutationExpectation(current, expected)
          if (!current || current.kind !== "file" || !isLive(current)) {
            setResult(false)
            return
          }
          const blobRequest = blobStore.get(current.blobRef.key)
          blobRequest.onerror = () =>
            abort(blobRequest.error ?? new Error("读取待删除文件内容失败"))
          blobRequest.onsuccess = () => {
            try {
              const record = blobRequest.result as BlobRecord | undefined
              const now = Date.now()
              if (record) {
                trashStore.put({
                  id: current.id,
                  node: current,
                  blob: record.blob,
                  capturedAt: now,
                } satisfies TrashSnapshot)
              } else {
                // Blob 已缺失时不能沿用旧一代快照，否则回收站会错误显示为可恢复。
                trashStore.delete(current.id)
              }
              nodeStore.put({
                ...current,
                deletedAt: now,
                updatedAt: nextUpdatedAt(current.updatedAt, now),
              } satisfies FileNode)
              blobStore.delete(current.blobRef.key)
              setResult(true)
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
  if (deleted) notifyFilesUpdated({ kind: "file", id })
  return deleted
}

/** 撤销删除: 把刚删除的文件 (含 Blob) 恢复 (重放 Blob + 节点清删除标记, 保留 id/createdAt)。 */
export async function restoreFile(file: StoredFile): Promise<void> {
  const now = Date.now()
  await idbRunTransaction<void>(
    [STORE_BLOBS, STORE_NODES],
    "readwrite",
    (transaction, setResult, abort) => {
      const blobStore = transaction.objectStore(STORE_BLOBS)
      const nodeStore = transaction.objectStore(STORE_NODES)
      const request = nodeStore.get(file.id)
      request.onerror = () => abort(request.error ?? new Error("读取待恢复文件失败"))
      request.onsuccess = () => {
        try {
          const current = request.result as Node | undefined
          if (current && current.kind !== "file") {
            throw new Error("待恢复文件 id 已被其它节点占用")
          }
          const revive = (
            parentId: string | null,
            sortKey: string,
            updatedAt: number,
          ): FileNode => ({
            id: file.id,
            kind: "file",
            title: file.name,
            parentId,
            sortKey,
            tags: file.tags,
            createdAt: file.createdAt,
            updatedAt,
            blobRef: { store: "blobs", key: file.id, size: file.size, mime: file.type },
            content: null,
          })
          const writeBlob = () => {
            blobStore.put({ key: file.id, blob: file.blob } satisfies BlobRecord)
            setResult(undefined)
          }
          if (current) {
            nodeStore.put(
              revive(current.parentId, current.sortKey, nextUpdatedAt(current.updatedAt, now)),
            )
            writeBlob()
            return
          }
          addNodeAtKindTail(
            nodeStore,
            { kind: "file", parentId: null },
            (sortKey) => revive(null, sortKey, now),
            writeBlob,
            abort,
          )
        } catch (error) {
          abort(error)
        }
      }
    },
  )
  notifyFilesUpdated({ kind: "file", id: file.id })
}
