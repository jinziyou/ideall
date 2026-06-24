// 对话线程本地存储仓库 (core 拥有) —— 折叠步 D 后物理统一到 nodes 仓库 (kind:"thread")。
// 经 HubDataPort 暴露给 agent 插件 (修依赖反转破例: 线程数据归 core, 插件作消费方, 不直接碰存储)。
// 消息语义属 agent 插件域, 本仓库以 unknown[] 透传 (同 NoteContent 不依赖编辑器实现)。
// 本地独占: 默认不跨端同步 (无 thread sync scope), 删除走硬删 (无需墓碑传播)。
import type { Thread } from "@protocol/hub-data"
import type { NodeKind, NodeOfKind } from "@protocol/node"
import { isLive } from "@protocol/sync"
import { genId } from "@/components/lib/id"
import { sortKeyBetween } from "./sort-key"
import { planThreadsSeed } from "./nodes-migrate"
import {
  idbBulkDelete,
  idbBulkPut,
  idbDelete,
  idbGet,
  idbGetAll,
  idbPut,
  idbReadModifyWrite,
  STORE_AGENT_THREADS,
  STORE_NODES,
} from "@/components/lib/idb"

type ThreadNode = NodeOfKind<"thread">

// ---- 节点 ↔ 域类型投影 ----

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

// ---- 懒迁移: 折叠步 D —— 旧 agentThreads 仓库 → thread 节点 ----

let seedPromise: Promise<void> | null = null

/** 折叠步 D 懒迁移 (模块级 once): 旧 agentThreads 仓库 → thread 节点, 清空旧仓库。 */
function seedThreadsOnce(): Promise<void> {
  if (!seedPromise) {
    seedPromise = doSeedThreads().catch((e) => {
      seedPromise = null
      throw e
    })
  }
  return seedPromise
}

async function doSeedThreads(): Promise<void> {
  const [rawThreads, existingNodes] = await Promise.all([
    idbGetAll<Record<string, unknown>>(STORE_AGENT_THREADS),
    idbGetAll<{ id: string }>(STORE_NODES),
  ])
  const plan = planThreadsSeed(rawThreads, new Set(existingNodes.map((n) => n.id)), Date.now())
  if (!plan) return // 旧仓库已空
  // 先写 thread 节点再清旧仓库; 顺序 put→delete 不丢, existingNodeIds 探测幂等。
  if (plan.puts.length) await idbBulkPut(STORE_NODES, plan.puts)
  if (plan.drainThreadIds.length) await idbBulkDelete(STORE_AGENT_THREADS, plan.drainThreadIds)
}

// ---- nodes 仓库内 kind 作用域读 + sortKey 追加 ----

async function allThreadNodes(): Promise<ThreadNode[]> {
  const all = await idbGetAll<{ id: string; kind?: NodeKind }>(STORE_NODES)
  return all.filter((n): n is ThreadNode => n.kind === "thread")
}

/** 同级最大 sortKey。 */
function maxKey(nodes: { sortKey: string }[]): string | null {
  const keys = nodes
    .map((n) => n.sortKey)
    .filter((k) => typeof k === "string" && k.length > 0)
    .sort()
  return keys.length ? keys[keys.length - 1] : null
}

/** 自 after 起一个严格递增追加键 (线程列表按 updatedAt 展示, sortKey 仅供就绪)。 */
function nextKey(after: string | null): string {
  try {
    return sortKeyBetween(after, null)
  } catch {
    return sortKeyBetween(null, null)
  }
}

// ---- 读 ----

/** 线程列表, 按最近更新倒序。 */
export async function listThreads(): Promise<Thread[]> {
  await seedThreadsOnce()
  return (await allThreadNodes())
    .filter(isLive)
    .map(nodeToThread)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getThread(id: string): Promise<Thread | undefined> {
  await seedThreadsOnce()
  const n = await idbGet<ThreadNode>(STORE_NODES, id)
  if (!n || n.kind !== "thread" || !isLive(n)) return undefined
  return nodeToThread(n)
}

/** 活跃线程数 —— 数量徽标用。 */
export async function countThreads(): Promise<number> {
  await seedThreadsOnce()
  return (await allThreadNodes()).filter(isLive).length
}

// ---- 写 ----

/** 新建空线程并落库。 */
export async function createThread(): Promise<Thread> {
  await seedThreadsOnce()
  const now = Date.now()
  const thread: Thread = { id: genId("thread"), title: "新对话", messages: [], createdAt: now, updatedAt: now }
  const sortKey = nextKey(maxKey(await allThreadNodes()))
  await idbPut(STORE_NODES, threadToNode(thread, sortKey))
  return thread
}

/** 整体写回线程 (消息内联); 刷新 updatedAt, 保留/追加 sortKey。 */
export async function saveThread(thread: Thread): Promise<void> {
  await seedThreadsOnce()
  const all = await allThreadNodes()
  const cur = all.find((n) => n.id === thread.id)
  const sortKey = cur?.sortKey || nextKey(maxKey(all))
  await idbPut(STORE_NODES, threadToNode({ ...thread, updatedAt: Date.now() }, sortKey))
}

/** 物理删除 (线程本地独占, 无需墓碑传播); kind 守卫确保只删 thread 节点 (与其它 kind 作用域操作一致)。 */
export async function deleteThread(id: string): Promise<void> {
  await seedThreadsOnce()
  const n = await idbGet<ThreadNode>(STORE_NODES, id)
  if (n && n.kind === "thread") await idbDelete(STORE_NODES, id)
}

export async function renameThread(id: string, title: string): Promise<void> {
  await seedThreadsOnce()
  await idbReadModifyWrite<ThreadNode>(STORE_NODES, id, (current) =>
    current && current.kind === "thread"
      ? { ...current, title: title.trim() || current.title, updatedAt: Date.now() }
      : undefined,
  )
}
