import type { Thread } from "@protocol/files"
import type { NodeOfKind } from "@protocol/node"
import { addNodeAtKindTail } from "@/files/stores/node-tail-transaction"

export type StoredThreadNode = NodeOfKind<"thread">

function threadNode(thread: Thread, sortKey: string): StoredThreadNode {
  return {
    id: thread.id,
    kind: "thread",
    title: thread.title,
    parentId: null,
    sortKey,
    tags: [],
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    content: { messages: thread.messages },
  }
}

/**
 * 在调用方已经持有的 nodes readwrite 事务内，以反向 covering key cursor 读取 thread
 * 尾键并 add 新节点。读取与写入不能拆成两个事务，否则并发窗口可能生成相同 sortKey。
 */
export function addThreadNodeAtTail(
  nodeStore: IDBObjectStore,
  thread: Thread,
  complete: (node: StoredThreadNode) => void,
  abort: (error: unknown) => void,
): void {
  addNodeAtKindTail(
    nodeStore,
    { kind: "thread", parentId: null },
    (sortKey) => threadNode(thread, sortKey),
    complete,
    abort,
  )
}
