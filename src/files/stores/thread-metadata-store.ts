import type { NodeOfKind } from "@protocol/node"
import {
  idbReadIndexKeySnapshot,
  idbReadIndexKeyRangesSnapshot,
  INDEX_NODES_DELETED_AT,
  INDEX_NODES_THREAD_METADATA,
  STORE_NODES,
  type IDBIndexKeyEntry,
} from "@/lib/idb"

const THREAD_METADATA_POINT_LOOKUP_THRESHOLD = 256

type ThreadMetadataKey = [
  kind: "thread",
  id: string,
  title: string,
  updatedAt: number,
  sortKey: string,
  createdAt: number,
]

function isThreadMetadataKey(value: IDBValidKey): value is ThreadMetadataKey {
  return (
    Array.isArray(value) &&
    value.length === 6 &&
    value[0] === "thread" &&
    typeof value[1] === "string" &&
    typeof value[2] === "string" &&
    typeof value[3] === "number" &&
    Number.isFinite(value[3]) &&
    typeof value[4] === "string" &&
    typeof value[5] === "number" &&
    Number.isFinite(value[5])
  )
}

/** 列出全部活跃线程 metadata；只遍历覆盖索引，不读取 messages。 */
export async function listThreadMetadata(): Promise<Array<NodeOfKind<"thread">>> {
  const range = IDBKeyRange.bound(["thread"], ["thread", []])
  const { entries, excludedPrimaryKeys } = await idbReadIndexKeySnapshot(
    STORE_NODES,
    INDEX_NODES_THREAD_METADATA,
    range,
    INDEX_NODES_DELETED_AT,
  )
  return threadMetadataFromIndexSnapshot(entries, excludedPrimaryKeys)
}

/** 将同一事务取得的 covering-index key 与 tombstone 主键投影为安全线程 metadata。 */
export function threadMetadataFromIndexSnapshot(
  entries: readonly IDBIndexKeyEntry[],
  excludedPrimaryKeys: readonly IDBValidKey[],
): Array<NodeOfKind<"thread">> {
  const deleted = new Set(
    excludedPrimaryKeys.filter((key): key is string => typeof key === "string"),
  )
  const metadata: Array<NodeOfKind<"thread">> = []
  for (const entry of entries) {
    if (!isThreadMetadataKey(entry.key)) continue
    const [, id, title, updatedAt, sortKey, createdAt] = entry.key
    if (deleted.has(id) || entry.primaryKey !== id) continue
    metadata.push({
      id,
      kind: "thread",
      title,
      parentId: null,
      sortKey,
      tags: [],
      createdAt,
      updatedAt,
      content: { messages: [] },
    })
  }
  return metadata
}

/**
 * 按输入 id 顺序返回线程安全 metadata。底层只读取 compound index key，不会把 messages
 * 从 IndexedDB 克隆到内存；软删除主键在同一 readonly 事务内取得并排除。
 */
export async function getThreadMetadataMany(
  ids: readonly string[],
): Promise<Array<NodeOfKind<"thread"> | undefined>> {
  if (ids.length === 0) return []
  const requested = new Set(ids)
  const metadata =
    requested.size <= THREAD_METADATA_POINT_LOOKUP_THRESHOLD
      ? await (async () => {
          const { entries, excludedPrimaryKeys } = await idbReadIndexKeyRangesSnapshot(
            STORE_NODES,
            INDEX_NODES_THREAD_METADATA,
            [...requested].map((id) => IDBKeyRange.bound(["thread", id], ["thread", id, []])),
            INDEX_NODES_DELETED_AT,
          )
          return threadMetadataFromIndexSnapshot(entries, excludedPrimaryKeys)
        })()
      : await listThreadMetadata()
  const byId = new Map(
    metadata.filter((node) => requested.has(node.id)).map((node) => [node.id, node]),
  )
  return ids.map((id) => byId.get(id))
}
