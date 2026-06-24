// 折叠步 A 的纯转换 (与 IndexedDB I/O 解耦, 便于单测): 把旧 notes 仓库的笔记播种进统一 nodes 仓库。
// 见 docs/design/ai-native-redesign.md §3 (步 A: notes 播种, 加 kind:"note", 逻辑零改)。
// 纯本地、无服务端备份, 故正确性 (零丢数据 + 幂等 + 墓碑保留) 由 nodes-migrate.test.ts 锁死。
import type { Note } from "@protocol/hub-data"
import type { NoteNode } from "@protocol/node"

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
