// 对话线程本地存储仓库 (core 拥有) —— 折叠步 D 后物理统一到 nodes 仓库 (kind:"thread")。
// 经 FilesPort 暴露给 agent 插件 (修依赖反转破例: 线程数据归 core, 插件作消费方, 不直接碰存储)。
// 消息语义属 agent 插件域, 本仓库以 unknown[] 透传 (同 NoteContent 不依赖编辑器实现)。
// 本地独占: 默认不跨端同步 (无 thread sync scope), 删除走本机软删以进入统一回收站。
import type { Thread } from "@protocol/files"
import type { NodeKind, NodeOfKind } from "@protocol/node"
import { isLive } from "@protocol/sync"
import { genId } from "@/lib/id"
import { appendSortKey, maxSortKey } from "@/files/sort-key"
import {
  idbGet,
  idbGetAllFromIndex,
  idbPut,
  idbReadModifyWrite,
  INDEX_NODES_KIND,
  STORE_NODES,
} from "@/lib/idb"
import { notifyFilesUpdated } from "@protocol/flowback"
import { captureTrashSnapshot } from "@/files/stores/trash-store"
import { nextUpdatedAt } from "@/files/version"

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

function threadToNode(t: Thread, sortKey: string): ThreadNode {
  return {
    id: t.id,
    kind: "thread",
    title: t.title,
    parentId: null,
    sortKey,
    tags: [],
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    content: { messages: t.messages },
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
export async function createThread(): Promise<Thread> {
  const now = Date.now()
  const thread: Thread = {
    id: genId("thread"),
    title: "新对话",
    messages: [],
    createdAt: now,
    updatedAt: now,
  }
  const sortKey = appendSortKey(maxSortKey(await allThreadNodes()))
  await idbPut(STORE_NODES, threadToNode(thread, sortKey))
  notifyFilesUpdated({ kind: "thread", id: thread.id })
  return thread
}

/** 整体写回线程 (消息内联); 刷新 updatedAt, 保留/追加 sortKey。 */
export async function saveThread(thread: Thread): Promise<void> {
  const all = await allThreadNodes()
  const cur = all.find((n) => n.id === thread.id)
  const sortKey = cur?.sortKey || appendSortKey(maxSortKey(all))
  const updatedAt = cur ? nextUpdatedAt(cur.updatedAt) : Date.now()
  await idbPut(STORE_NODES, threadToNode({ ...thread, updatedAt }, sortKey))
  notifyFilesUpdated({ kind: "thread", id: thread.id })
}

/** 软删除线程: 写 deletedAt 进入统一回收站; kind 守卫确保只改 thread 节点。 */
export async function deleteThread(id: string): Promise<void> {
  const n = await idbGet<ThreadNode>(STORE_NODES, id)
  if (!n || n.kind !== "thread" || !isLive(n)) return
  const now = Date.now()
  await captureTrashSnapshot(n)
  await idbPut(STORE_NODES, {
    ...n,
    deletedAt: now,
    updatedAt: nextUpdatedAt(n.updatedAt, now),
  })
  notifyFilesUpdated({ kind: "thread", id })
}

export async function renameThread(id: string, title: string): Promise<void> {
  const next = await idbReadModifyWrite<ThreadNode>(STORE_NODES, id, (current) =>
    current && current.kind === "thread"
      ? {
          ...current,
          title: title.trim() || current.title,
          updatedAt: nextUpdatedAt(current.updatedAt),
        }
      : undefined,
  )
  if (next) notifyFilesUpdated({ kind: "thread", id })
}
