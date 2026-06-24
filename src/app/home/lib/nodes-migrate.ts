// 折叠各步的纯转换 (与 IndexedDB I/O 解耦, 便于单测): 把旧各实体仓库播种进统一 nodes 仓库。
// 见 docs/design/ai-native-redesign.md §3 (步 A: notes; 步 B: bookmarks/folders …)。
// 纯本地、无服务端备份, 故正确性 (零丢数据 + 幂等 + 墓碑保留) 由 nodes-migrate.test.ts 锁死。
import type { Note } from "@protocol/hub-data"
import type { NoteNode, NodeOfKind } from "@protocol/node"
import { sequentialSortKeys } from "./sort-key"

type BookmarkNode = NodeOfKind<"bookmark">
type FolderNode = NodeOfKind<"folder">

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

  const folderIds = new Set(rawFolders.map((f) => f.id as string).filter((id) => typeof id === "string"))

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
