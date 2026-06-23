// 页树组装回归网 (node:test + tsx)。锁死可达性不变量: 每个活跃节点都必须从某根可达 ——
// 含跨端并发 move 合并出的「双向环」(A.parentId=B & B.parentId=A), 否则环节点在页树中消失、无法管理。
import { test } from "node:test"
import assert from "node:assert/strict"

import { buildNoteTree, effectiveParentId, buildParentOf, type TreeNode } from "./notes-tree-util"
import type { NoteMeta } from "../model"

function meta(id: string, parentId: string | null, sortKey: string): NoteMeta {
  return { id, title: id, parentId, sortKey, tags: [], createdAt: 0, updatedAt: 0, excerpt: "", search: "", hasChildren: false }
}

/** 摊平森林为 id 集, 校验每个传入节点都被枚举到 (可达)。 */
function allIds(forest: TreeNode[]): Set<string> {
  const out = new Set<string>()
  const walk = (nodes: TreeNode[]) => {
    for (const n of nodes) {
      out.add(n.note.id)
      walk(n.children)
    }
  }
  walk(forest)
  return out
}

test("普通层级: 根下挂子页, 同级按 sortKey 排序", () => {
  const notes = [meta("a", null, "a1"), meta("b", null, "a0"), meta("c", "a", "a0")]
  const forest = buildNoteTree(notes)
  assert.deepEqual(
    forest.map((n) => n.note.id),
    ["b", "a"],
    "根级按 sortKey 升序 (b 的 a0 在 a 的 a1 前)",
  )
  const a = forest.find((n) => n.note.id === "a")!
  assert.deepEqual(a.children.map((n) => n.note.id), ["c"])
})

test("孤儿 (parentId 指向不存在节点) 归根, 不消失", () => {
  const notes = [meta("x", "ghost", "a0")]
  const forest = buildNoteTree(notes)
  assert.deepEqual(forest.map((n) => n.note.id), ["x"])
})

test("双向环 A↔B + 子页 C: 三者都可达 (环成员重挂到根, C 仍挂 A 下)", () => {
  // 跨端并发: 设备1 A.parentId=B, 设备2 B.parentId=A, 合并后两条父边都活; C 是 A 的子页。
  const notes = [meta("A", "B", "a0"), meta("B", "A", "a1"), meta("C", "A", "a0")]
  const forest = buildNoteTree(notes)
  const ids = allIds(forest)
  assert.ok(ids.has("A") && ids.has("B") && ids.has("C"), `三节点都应可达, 实际: ${[...ids].join(",")}`)
  // 环成员 A、B 重挂到根
  const parentOf = buildParentOf(notes)
  assert.equal(effectiveParentId("A", "B", parentOf), null, "A 是环成员 → 归根")
  assert.equal(effectiveParentId("B", "A", parentOf), null, "B 是环成员 → 归根")
  // C 不是环成员, 仍挂在 A 下 (A 已是根 → C 经 A 可达)
  assert.equal(effectiveParentId("C", "A", parentOf), "A", "C 非环成员 → 保留父 A")
  const a = forest.find((n) => n.note.id === "A")
  assert.ok(a && a.children.some((c) => c.note.id === "C"), "C 应在 A 的子页中")
})

test("自指环 (A.parentId=A) 归根", () => {
  const notes = [meta("A", "A", "a0")]
  const forest = buildNoteTree(notes)
  assert.deepEqual(forest.map((n) => n.note.id), ["A"])
})

test("三元环 A→B→C→A 全部可达", () => {
  const notes = [meta("A", "C", "a0"), meta("B", "A", "a0"), meta("C", "B", "a0")]
  const ids = allIds(buildNoteTree(notes))
  assert.ok(ids.has("A") && ids.has("B") && ids.has("C"), `三元环三节点都应可达, 实际: ${[...ids].join(",")}`)
})
