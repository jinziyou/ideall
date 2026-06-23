// 递归页树的纯组装逻辑 (无 React, 供 notes-store 与 notes-tree 共用, 保证两侧层级一致)。
// 关键不变量: 每个活跃节点都必须从某个根可达。故「有效父」对以下三种情形一律重挂到根 (null):
//   - 根节点 (parentId=null);
//   - 孤儿 (parentId 指向已删/不存在的节点);
//   - 环成员 (沿 parentId 上溯会回到自身 —— 跨端并发 move 可合并出 A.parentId=B & B.parentId=A 的双向环)。
// 不重挂会让环节点及其子树永远不被根遍历枚举到 → 在页树中「消失」、无法选中/删除/移到根。
import type { NoteMeta } from "../model"

export type TreeNode = { note: NoteMeta; children: TreeNode[] }

/** 活跃集合的 id → parentId 映射 (parentOf.has(x) 即「x 是活跃节点」)。 */
export function buildParentOf(items: { id: string; parentId: string | null }[]): Map<string, string | null> {
  return new Map(items.map((n) => [n.id, n.parentId]))
}

/**
 * 节点的有效父 id。根/孤儿/环成员 → null; 否则原 parentId。
 * 环成员判定: 自 parentId 起沿父链上溯, 若回到 id 自身即为环成员 (重挂到根);
 * 上溯遇到「已访问过的非自身节点」表示本节点在环的下游 (其环成员祖先会各自被重挂), 保留原父即可经那条边可达。
 */
export function effectiveParentId(
  id: string,
  parentId: string | null,
  parentOf: Map<string, string | null>,
): string | null {
  if (parentId == null || !parentOf.has(parentId)) return null
  let cur: string | null = parentId
  const seen = new Set<string>()
  while (cur != null && parentOf.has(cur) && !seen.has(cur)) {
    if (cur === id) return null // 上溯回到自身 → 本节点是环成员 → 重挂到根
    seen.add(cur)
    cur = parentOf.get(cur) ?? null
  }
  return parentId
}

/** 同级稳定比较: 先按 sortKey 字典序, sortKey 并列时以 id 兜底 (跨端并发可能产生相同键)。 */
export function cmpSibling(a: NoteMeta, b: NoteMeta): number {
  if (a.sortKey !== b.sortKey) return a.sortKey < b.sortKey ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** 由活跃笔记元数据 (扁平) 组装递归森林: 按 effectiveParentId 分层, 同级按 sortKey 排序。 */
export function buildNoteTree(notes: NoteMeta[]): TreeNode[] {
  const parentOf = buildParentOf(notes)
  const childrenOf = new Map<string | null, NoteMeta[]>()
  for (const n of notes) {
    const ep = effectiveParentId(n.id, n.parentId, parentOf)
    const arr = childrenOf.get(ep) ?? []
    arr.push(n)
    childrenOf.set(ep, arr)
  }
  const visited = new Set<string>()
  const build = (parentId: string | null): TreeNode[] => {
    const kids = (childrenOf.get(parentId) ?? []).slice().sort(cmpSibling)
    const out: TreeNode[] = []
    for (const note of kids) {
      if (visited.has(note.id)) continue // 防御性: 同一节点不重复挂载
      visited.add(note.id)
      out.push({ note, children: build(note.id) })
    }
    return out
  }
  return build(null)
}
