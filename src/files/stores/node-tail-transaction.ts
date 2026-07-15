import type { NodeKind, NodeOfKind } from "@protocol/node"
import { sortKeyBetween } from "@/files/sort-key"
import { INDEX_NODES_KIND_SORT_KEY } from "@/lib/idb"

export type NodeKindTailScope<K extends NodeKind> = {
  kind: K
  parentId: string | null
}

function isKindSortKey<K extends NodeKind>(value: IDBValidKey, kind: K): value is [K, string] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value[0] === kind &&
    typeof value[1] === "string" &&
    value[1].length > 0
  )
}

/**
 * 在调用方已持有的 nodes readwrite 事务内，按 kind 的全局排序上界追加节点。
 *
 * v16 的 [kind, sortKey] covering index 可直接 seek 到最后一个有效键，不读取或
 * structured-clone 节点正文。kind 全局上界一定不小于目标 parent 的 sibling 尾键，
 * 因而适用于默认“追加到末尾”；显式插入位置与移动仍应使用 sibling 排序算法。
 */
export function addNodeAtKindTail<K extends NodeKind>(
  nodeStore: IDBObjectStore,
  scope: NodeKindTailScope<K>,
  build: (sortKey: string) => NodeOfKind<K>,
  complete: (node: NodeOfKind<K>) => void,
  abort: (error: unknown) => void,
): void {
  try {
    // 放在函数内访问，避免静态导出/SSR 加载模块时触碰浏览器全局。
    const range = IDBKeyRange.bound([scope.kind], [scope.kind, []])
    const request = nodeStore.index(INDEX_NODES_KIND_SORT_KEY).openKeyCursor(range, "prev")
    request.onerror = () => abort(request.error ?? new Error("读取节点排序尾键失败"))
    request.onsuccess = () => {
      try {
        const cursor = request.result
        let tail: string | null = null
        if (cursor) {
          const key = cursor.key
          if (!isKindSortKey(key, scope.kind)) {
            cursor.continue()
            return
          }
          tail = key[1]
        }
        // 尾键损坏时必须 fail closed。appendSortKey 的 a0 兼容回退可能小于损坏键，
        // 会破坏“全局上界晚于目标 siblings”的追加保证。
        const sortKey = sortKeyBetween(tail, null)
        const node = build(sortKey)
        if (
          node.kind !== scope.kind ||
          node.parentId !== scope.parentId ||
          node.sortKey !== sortKey
        ) {
          throw new Error("尾键节点工厂返回了不匹配的 kind、parentId 或 sortKey")
        }
        const addRequest = nodeStore.add(node)
        addRequest.onerror = () => abort(addRequest.error ?? new Error("新增尾部节点失败"))
        // complete 可继续同步排队 Blob/task 等依赖写；此时 add 已成功且事务仍处于 active 回调。
        addRequest.onsuccess = () => {
          try {
            complete(node)
          } catch (error) {
            abort(error)
          }
        }
      } catch (error) {
        abort(error)
      }
    }
  } catch (error) {
    abort(error)
  }
}
