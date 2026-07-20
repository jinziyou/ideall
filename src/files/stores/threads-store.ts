// 对话线程本地存储仓库 (core 拥有) —— 折叠步 D 后物理统一到 nodes 仓库 (kind:"thread")。
// 经 FilesPort 暴露给 agent 插件 (修依赖反转破例: 线程数据归 core, 插件作消费方, 不直接碰存储)。
// 消息语义属 agent 插件域, 本仓库以 unknown[] 透传 (同 NoteContent 不依赖编辑器实现)。
// 本地独占: 默认不跨端同步 (无 thread sync scope), 删除走本机软删以进入统一回收站。
import type { Thread } from "@protocol/files"
import type { NodeKind, NodeOfKind } from "@protocol/node"
import { isLive } from "@protocol/sync"
import { genId } from "@/lib/id"
import {
  idbGet,
  idbGetAllFromIndex,
  idbRunTransaction,
  INDEX_NODES_KIND,
  STORE_NODES,
} from "@/lib/idb"
import { addThreadNodeAtTail } from "@/files/stores/thread-node-transaction"
import {
  deleteTaskThread,
  saveThreadAndTouchTaskAtomic,
  updateThreadNodeAndTouchTaskAtomic,
} from "@/files/stores/thread-tasks-store"
import type { NodeMutationExpectation } from "@/files/stores/node-mutation"
import { notifyFilesUpdated } from "@protocol/flowback"

type ThreadNode = NodeOfKind<"thread">

// ---- 节点 ↔ 域类型映射 ----

function nodeToThread(n: ThreadNode): Thread {
  return {
    id: n.id,
    title: n.title,
    messages: n.content.messages,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
  }
}

// ---- nodes 仓库内 kind 作用域读 + sortKey 追加 ----

async function allThreadNodes(): Promise<ThreadNode[]> {
  const all = await idbGetAllFromIndex<{ id: string; kind?: NodeKind }>(
    STORE_NODES,
    INDEX_NODES_KIND,
    "thread",
  )
  return all.filter((n): n is ThreadNode => n.kind === "thread")
}

// ---- 读 ----

/** 线程列表, 按最近更新倒序。 */
export async function listThreads(): Promise<Thread[]> {
  return (await allThreadNodes())
    .filter(isLive)
    .map(nodeToThread)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getThread(id: string): Promise<Thread | undefined> {
  const n = await idbGet<ThreadNode>(STORE_NODES, id)
  if (!n || n.kind !== "thread" || !isLive(n)) return undefined
  return nodeToThread(n)
}

// ---- 写 ----

/** 新建空线程并落库。 */
export async function createThreadWithNode(): Promise<ThreadNode> {
  const now = Date.now()
  const thread: Thread = {
    id: genId("thread"),
    title: "新对话",
    messages: [],
    createdAt: now,
    updatedAt: now,
  }
  const node = await idbRunTransaction<ThreadNode>(
    [STORE_NODES],
    "readwrite",
    (transaction, setResult, abort) => {
      addThreadNodeAtTail(transaction.objectStore(STORE_NODES), thread, setResult, abort)
    },
  )
  notifyFilesUpdated({ kind: "thread", id: thread.id })
  return node
}

/** 兼容既有 FilesPort DTO；创建真相由 createThreadWithNode 返回。 */
export async function createThread(): Promise<Thread> {
  return nodeToThread(await createThreadWithNode())
}

/** 整体写回线程 (消息内联)，并在同一事务内刷新可能存在的 task 排序时间。 */
export async function saveThread(thread: Thread): Promise<void> {
  await saveThreadAndTouchTaskAtomic(thread)
}

/** 软删除线程；回收站快照、删除标记及可能存在的 task 关系在同一事务提交。 */
export async function deleteThread(
  id: string,
  expected?: NodeMutationExpectation,
): Promise<boolean> {
  return (await deleteTaskThread(id, expected)).deleted
}

export async function updateThread(
  id: string,
  patch: { title?: string; messages?: unknown[] },
  expected?: NodeMutationExpectation,
): Promise<ThreadNode | undefined> {
  return updateThreadNodeAndTouchTaskAtomic(id, patch, expected)
}

export async function renameThread(
  id: string,
  title: string,
  expected?: NodeMutationExpectation,
): Promise<ThreadNode | undefined> {
  const trimmed = title.trim()
  return updateThread(id, trimmed ? { title: trimmed } : {}, expected)
}
