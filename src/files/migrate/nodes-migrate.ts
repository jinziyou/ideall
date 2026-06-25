// 折叠各步的纯转换 (与 IndexedDB I/O 解耦, 便于单测): 把旧各实体仓库播种进统一 nodes 仓库。
// 见 docs/design/ai-native-redesign.md §3 (步 A: notes; 步 B: bookmarks/folders …)。
// 纯本地、无服务端备份, 故正确性 (零丢数据 + 幂等 + 墓碑保留) 由 nodes-migrate.test.ts 锁死。
import type { Note } from "@protocol/files"
import type { Subscription } from "@protocol/subscription"
import type { NoteNode, NodeOfKind } from "@protocol/node"
import { sequentialSortKeys } from "@/files/sort-key"

type BookmarkNode = NodeOfKind<"bookmark">
type FolderNode = NodeOfKind<"folder">
type FileNode = NodeOfKind<"file">
type FeedNode = NodeOfKind<"feed">
type ThreadNode = NodeOfKind<"thread">

function asStr(x: unknown): string {
  return typeof x === "string" ? x : ""
}
function asNum(x: unknown, fallback: number): number {
  return typeof x === "number" ? x : fallback
}

/** puts: 要写入 nodes 仓库的笔记节点; drainNoteIds: 播种后要从旧 notes 仓库清除的 id (单一真相)。 */
export type NodesSeedPlan = { puts: NoteNode[]; drainNoteIds: string[] }

/**
 * 规划一次播种。返回 null = 旧 notes 仓库为空 (无存量 / 已清空 → 幂等空操作)。
 * - 每条笔记原样复制 + 打 kind:"note" (正文/标签/时间/sortKey/parentId/墓碑 deletedAt 全保留);
 *   漏带墓碑 = 已删笔记复活, 故含墓碑全量带过来。
 * - existingNodeIds (nodes 仓库已有的 id): 已播种的不重写 → 崩溃重跑幂等, 不覆盖播种后产生的本地编辑。
 * - drainNoteIds 始终为旧仓库全部笔记 id: 即便本轮未重写 (已存在), 仍需收尾清空旧仓库。
 */
export function planNodesSeed(
  rawNotes: Record<string, unknown>[],
  existingNodeIds: Set<string>,
): NodesSeedPlan | null {
  if (rawNotes.length === 0) return null
  const puts: NoteNode[] = []
  const drainNoteIds: string[] = []
  for (const raw of rawNotes) {
    const id = raw.id as string
    if (typeof id !== "string" || !id) continue // 无 id 的脏记录跳过 (既不播种也不清, 不丢)
    drainNoteIds.push(id)
    if (existingNodeIds.has(id)) continue // 已播种 → 不覆盖
    // 原样复制旧笔记 + 加 kind; 旧笔记已是树形合法 Note (步 A 在树迁移之后跑)。
    puts.push({ ...(raw as unknown as Note), kind: "note" })
  }
  return { puts, drainNoteIds }
}

// ---- 折叠步 B: 书签 + 收藏夹 → nodes (kind:"bookmark"/"folder") ----

/** puts: 书签 + 收藏夹节点; drain*Ids: 播种后要从旧 bookmarks/bookmarkFolders 仓库清除的 id。 */
export type BookmarksSeedPlan = {
  puts: (BookmarkNode | FolderNode)[]
  drainBookmarkIds: string[]
  drainFolderIds: string[]
}

/**
 * 规划书签/收藏夹播种。返回 null = 两个旧仓库都空 (无存量 / 已清空 → 幂等空操作)。
 * - 收藏夹 → kind:"folder" 节点 (复用 id; name→title; 根级 parentId=null)。
 * - 书签 → kind:"bookmark" 节点 (复用 id; folderId→parentId, 指向不存在的收藏夹则归根 null;
 *   url/description/favicon 收进 content; title/tags 留顶层); 旧书签硬删无墓碑, 故全为活跃。
 * - 补 sortKey (同 parentId 组内按 createdAt 升序发严格递增键; 书签列表仍按 createdAt 展示, sortKey 仅供树/拖拽就绪)
 *   与 updatedAt (= createdAt, 旧记录无版本时间)。
 * - existingNodeIds 已播种的不重写 (崩溃重跑幂等); drain 始终为旧仓库全部 id (收尾清空)。
 * now 注入 (缺失时间戳兜底), 便于测试确定性。
 */
export function planBookmarksSeed(
  rawBookmarks: Record<string, unknown>[],
  rawFolders: Record<string, unknown>[],
  existingNodeIds: Set<string>,
  now: number,
): BookmarksSeedPlan | null {
  if (rawBookmarks.length === 0 && rawFolders.length === 0) return null

  const folderIds = new Set(
    rawFolders.map((f) => f.id as string).filter((id) => typeof id === "string"),
  )

  const folderNodes: FolderNode[] = rawFolders
    .filter((f) => typeof f.id === "string" && f.id)
    .map((f) => {
      const createdAt = asNum(f.createdAt, now)
      return {
        id: f.id as string,
        kind: "folder",
        title: asStr(f.name) || "未命名收藏夹",
        parentId: null,
        sortKey: "",
        tags: [],
        createdAt,
        updatedAt: createdAt,
        content: null,
      }
    })

  const bookmarkNodes: BookmarkNode[] = rawBookmarks
    .filter((b) => typeof b.id === "string" && b.id)
    .map((b) => {
      const createdAt = asNum(b.createdAt, now)
      const oldFolder = (b as { folderId?: unknown }).folderId
      const parentId = typeof oldFolder === "string" && folderIds.has(oldFolder) ? oldFolder : null
      return {
        id: b.id as string,
        kind: "bookmark",
        title: asStr(b.title) || asStr(b.url),
        parentId,
        sortKey: "",
        tags: Array.isArray(b.tags) ? (b.tags as string[]) : [],
        createdAt,
        updatedAt: createdAt,
        content: {
          url: asStr(b.url),
          description: asStr(b.description),
          favicon: asStr(b.favicon),
        },
      }
    })

  // 同 parentId 组内按 createdAt 升序发严格递增 sortKey (折叠/收藏夹同组, 键全局一致, 供后续统一侧栏树)。
  const all: (BookmarkNode | FolderNode)[] = [...folderNodes, ...bookmarkNodes]
  const groups = new Map<string | null, (BookmarkNode | FolderNode)[]>()
  for (const n of all) {
    const arr = groups.get(n.parentId) ?? []
    arr.push(n)
    groups.set(n.parentId, arr)
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))
    const keys = sequentialSortKeys(group.length)
    group.forEach((n, i) => {
      n.sortKey = keys[i]
    })
  }

  // 已播种的不重写 (幂等); drain 始终全量 (收尾清空旧仓库)。
  const puts = all.filter((n) => !existingNodeIds.has(n.id))
  return {
    puts,
    drainBookmarkIds: bookmarkNodes.map((n) => n.id),
    drainFolderIds: folderNodes.map((n) => n.id),
  }
}

// ---- 折叠步 B 续: 文件 → nodes (kind:"file") + Blob 旁存 ----

/** nodePuts: 文件节点 (存 blobRef, 不含二进制); blobPuts: 旁存的二进制; drainFileIds: 清旧 files 仓库。 */
export type FilesSeedPlan = {
  nodePuts: FileNode[]
  blobPuts: { key: string; blob: Blob }[]
  drainFileIds: string[]
}

/**
 * 规划文件播种。返回 null = 旧 files 仓库为空 (无存量 / 已清空)。
 * - 旧 StoredFile (内联 Blob) → 文件节点 (name→title, type/size→blobRef, blob 拆到旁存) + blob 记录 {key,blob}。
 *   blobRef.key = 文件 id (1:1 旁存)。Blob 缺失的脏记录仍迁节点 (不丢元数据), 仅跳过 blob 旁存。
 * - 补 sortKey (按 createdAt 升序) 与 updatedAt(=createdAt)。
 * - existingNodeIds 已播种的节点/blob 都不重写 (幂等); drain 始终全量。
 * now 注入 (缺时间戳兜底), 便于测试确定性。
 */
export function planFilesSeed(
  rawFiles: Record<string, unknown>[],
  existingNodeIds: Set<string>,
  now: number,
): FilesSeedPlan | null {
  if (rawFiles.length === 0) return null

  const built: { node: FileNode; blob?: Blob }[] = []
  for (const raw of rawFiles) {
    const id = raw.id as string
    if (typeof id !== "string" || !id) continue // 无 id 脏记录跳过, 不丢 (既不迁也不 drain)
    const blob = raw.blob instanceof Blob ? raw.blob : undefined
    const createdAt = asNum(raw.createdAt, now)
    const node: FileNode = {
      id,
      kind: "file",
      title: asStr(raw.name) || "未命名文件",
      parentId: null,
      sortKey: "",
      tags: Array.isArray(raw.tags) ? (raw.tags as string[]) : [],
      createdAt,
      updatedAt: createdAt,
      blobRef: {
        store: "blobs",
        key: id,
        size: asNum(raw.size, blob ? blob.size : 0),
        mime: asStr(raw.type),
      },
      content: null,
    }
    built.push({ node, blob })
  }

  // 文件均为根级 (parentId=null); 按 createdAt 升序发严格递增 sortKey。
  built.sort((a, b) => a.node.createdAt - b.node.createdAt || (a.node.id < b.node.id ? -1 : 1))
  const keys = sequentialSortKeys(built.length)
  built.forEach((b, i) => {
    b.node.sortKey = keys[i]
  })

  const fresh = built.filter((b) => !existingNodeIds.has(b.node.id))
  return {
    nodePuts: fresh.map((b) => b.node),
    blobPuts: fresh.filter((b) => b.blob).map((b) => ({ key: b.node.id, blob: b.blob as Blob })),
    drainFileIds: built.map((b) => b.node.id),
  }
}

// ---- 折叠步 C: 订阅 → feed 节点 (kind:"feed", 确定性 id) ----
// 投影助手单一真相 (迁移 + subscriptions-store 运行期共用, 防双处映射漂移)。

/** 确定性 feed 节点 id: feed:type:key (绝不 genId; 两端独立创建同订阅得同 id → 跨端零 churn)。 */
export function feedNodeId(type: string, key: string): string {
  return `feed:${type}:${key}`
}

/** Subscription → feed 节点。sortKey 由调用方算 (迁移=顺序键, 运行期=追加键)。墓碑 deletedAt 原样带过。 */
export function subToFeedNode(sub: Subscription, sortKey: string): FeedNode {
  const content: FeedNode["content"] = {
    type: sub.type,
    key: sub.key,
    favicon: sub.favicon ?? "",
  }
  if (sub.entityLabel !== undefined) content.entityLabel = sub.entityLabel
  if (sub.entityName !== undefined) content.entityName = sub.entityName
  if (sub.searchKeyword !== undefined) content.searchKeyword = sub.searchKeyword
  if (sub.searchDomain !== undefined) content.searchDomain = sub.searchDomain
  const node: FeedNode = {
    id: feedNodeId(sub.type, sub.key),
    kind: "feed",
    title: sub.title,
    parentId: null,
    sortKey,
    tags: [],
    createdAt: sub.createdAt,
    updatedAt: sub.updatedAt ?? sub.createdAt,
    content,
  }
  if (sub.deletedAt !== undefined) node.deletedAt = sub.deletedAt
  return node
}

/** feed 节点 → Subscription (反投影)。wire id 由 content.type:key 重建 = 旧确定性 id, 同步合并/旧端兼容。 */
export function feedNodeToSub(n: FeedNode): Subscription {
  const c = n.content
  const sub: Subscription = {
    id: `${c.type}:${c.key}`,
    type: c.type,
    key: c.key,
    title: n.title,
    favicon: c.favicon,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
  }
  if (c.entityLabel !== undefined) sub.entityLabel = c.entityLabel
  if (c.entityName !== undefined) sub.entityName = c.entityName
  if (c.searchKeyword !== undefined) sub.searchKeyword = c.searchKeyword
  if (c.searchDomain !== undefined) sub.searchDomain = c.searchDomain
  if (n.deletedAt !== undefined) sub.deletedAt = n.deletedAt
  return sub
}

/** puts: feed 节点 (含墓碑全量); drainSubIds: 播种后要从旧 subscriptions 仓库清除的 id (= type:key)。 */
export type FeedsSeedPlan = { puts: FeedNode[]; drainSubIds: string[] }

/**
 * 规划订阅播种。返回 null = 旧 subscriptions 仓库为空。
 * - 每条订阅 → feed 节点 (确定性 id feed:type:key); type/key/favicon 与 entity/search 专属字段收进 content;
 *   **含墓碑全量带过来** (deletedAt 原样保留) —— 漏带 = 已删订阅在跨端合并时被对端活跃副本复活。
 * - 补 sortKey (按 createdAt 升序); existingNodeIds 已播种的不重写 (幂等); drain 始终全量。
 * now 注入 (缺时间戳兜底), 便于测试确定性。
 */
export function planFeedsSeed(
  rawSubs: Record<string, unknown>[],
  existingNodeIds: Set<string>,
  now: number,
): FeedsSeedPlan | null {
  if (rawSubs.length === 0) return null
  const built: FeedNode[] = []
  const drainSubIds: string[] = []
  for (const raw of rawSubs) {
    const type = raw.type
    const key = raw.key
    if (typeof type !== "string" || typeof key !== "string" || !type || !key) continue // 脏记录跳过
    drainSubIds.push(typeof raw.id === "string" && raw.id ? raw.id : `${type}:${key}`)
    const createdAt = asNum(raw.createdAt, now)
    const sub: Subscription = {
      id: `${type}:${key}`,
      type: type as Subscription["type"],
      key,
      title: asStr(raw.title) || key,
      favicon: asStr(raw.favicon),
      createdAt,
      updatedAt: asNum(raw.updatedAt, createdAt),
    }
    if (typeof raw.entityLabel === "string") sub.entityLabel = raw.entityLabel
    if (typeof raw.entityName === "string") sub.entityName = raw.entityName
    if (typeof raw.searchKeyword === "string") sub.searchKeyword = raw.searchKeyword
    if (typeof raw.searchDomain === "string") sub.searchDomain = raw.searchDomain
    if (typeof raw.deletedAt === "number") sub.deletedAt = raw.deletedAt // 墓碑保留
    built.push(subToFeedNode(sub, ""))
  }

  built.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))
  const keys = sequentialSortKeys(built.length)
  built.forEach((n, i) => {
    n.sortKey = keys[i]
  })

  return { puts: built.filter((n) => !existingNodeIds.has(n.id)), drainSubIds }
}

// ---- 折叠步 D: 线程 → thread 节点 (kind:"thread", 四步折叠收官) ----

/** puts: thread 节点 (messages 以 unknown[] 透传, 不解读语义); drainThreadIds: 清旧 agentThreads 仓库。 */
export type ThreadsSeedPlan = { puts: ThreadNode[]; drainThreadIds: string[] }

/**
 * 规划线程播种。返回 null = 旧 agentThreads 仓库为空。
 * - 每条线程 → thread 节点 (messages 原样收进 content, 协议层不解读其语义); 线程本地独占无墓碑 (硬删)。
 * - 补 sortKey (按 createdAt 升序; 线程列表按 updatedAt 展示, sortKey 仅供就绪); existingNodeIds 幂等; drain 全量。
 * now 注入 (缺时间戳兜底), 便于测试确定性。
 */
export function planThreadsSeed(
  rawThreads: Record<string, unknown>[],
  existingNodeIds: Set<string>,
  now: number,
): ThreadsSeedPlan | null {
  if (rawThreads.length === 0) return null
  const built: ThreadNode[] = []
  const drainThreadIds: string[] = []
  for (const raw of rawThreads) {
    const id = raw.id as string
    if (typeof id !== "string" || !id) continue // 脏记录跳过
    drainThreadIds.push(id)
    const createdAt = asNum(raw.createdAt, now)
    built.push({
      id,
      kind: "thread",
      title: asStr(raw.title) || "新对话",
      parentId: null,
      sortKey: "",
      tags: [],
      createdAt,
      updatedAt: asNum(raw.updatedAt, createdAt),
      content: { messages: Array.isArray(raw.messages) ? raw.messages : [] },
    })
  }

  built.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))
  const keys = sequentialSortKeys(built.length)
  built.forEach((n, i) => {
    n.sortKey = keys[i]
  })

  return { puts: built.filter((n) => !existingNodeIds.has(n.id)), drainThreadIds }
}
