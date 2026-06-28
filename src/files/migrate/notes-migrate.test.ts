// 笔记「扁平 → 递归页树」迁移回归网 (node:test + tsx)。纯本地无服务端备份, 故锁死:
//   - 零丢数据: 每条旧笔记都成一个树节点, 正文/标签/时间/墓碑原样保留;
//   - 复用 notebook.id 作目录页 id → 子笔记 parentId 零重指;
//   - 同 parentId 组内 sortKey 严格递增且无碰撞 (含「根级目录页 + 未分组笔记」同组);
//   - 孤儿 (notebookId 指向不存在笔记本) 归根;
//   - 幂等: 已迁移 (有 sortKey、无 notebookId) → null; 崩溃重跑不重建已迁移节点但仍清旧笔记本。
import { test } from "node:test"
import assert from "node:assert/strict"

import { planNotesTreeMigration } from "@/files/migrate/notes-migrate"
import type { Note } from "@protocol/files"

const NOW = 1_700_000_000_000

/** 取某 parentId 下的子节点 (按 sortKey 升序), 断言键严格递增且唯一。 */
function childrenSorted(puts: Note[], parentId: string | null): Note[] {
  const kids = puts
    .filter((n) => n.parentId === parentId)
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1))
  for (let i = 1; i < kids.length; i++) {
    assert.ok(
      kids[i - 1].sortKey < kids[i].sortKey,
      `同级 sortKey 应严格递增: ${kids[i - 1].sortKey} < ${kids[i].sortKey}`,
    )
  }
  assert.equal(new Set(kids.map((k) => k.sortKey)).size, kids.length, "同级 sortKey 不得碰撞")
  return kids
}

test("空库 → null (无操作)", () => {
  assert.equal(planNotesTreeMigration([], [], NOW), null)
})

test("已迁移 (笔记有 sortKey、无 notebookId, 笔记本已空) → null (幂等)", () => {
  const migrated = [
    {
      id: "n1",
      title: "a",
      content: [],
      parentId: null,
      sortKey: "a0",
      tags: [],
      createdAt: 1,
      updatedAt: 1,
    },
  ]
  assert.equal(planNotesTreeMigration(migrated, [], NOW), null)
})

test("笔记本 + 子笔记: 目录页复用 notebook.id, 子笔记 parentId 零重指, 数据保留", () => {
  const notes = [
    {
      id: "n1",
      title: "子1",
      content: [{ type: "p", children: [{ text: "正文1" }] }],
      notebookId: "nb1",
      tags: ["x"],
      createdAt: 10,
      updatedAt: 20,
    },
    {
      id: "n2",
      title: "子2",
      content: [],
      notebookId: "nb1",
      tags: [],
      createdAt: 11,
      updatedAt: 30,
      deletedAt: 99,
    },
  ]
  const notebooks = [{ id: "nb1", name: "我的本子", createdAt: 5 }]
  const plan = planNotesTreeMigration(notes, notebooks, NOW)
  assert.ok(plan)
  // 目录页: 复用 nb1 id, 根级
  const dir = plan!.puts.find((p) => p.id === "nb1")
  assert.ok(dir, "应生成目录页 nb1")
  assert.equal(dir!.parentId, null)
  assert.equal(dir!.title, "我的本子")
  // 子笔记 parentId = nb1 (零重指), 数据保留
  const c1 = plan!.puts.find((p) => p.id === "n1")!
  assert.equal(c1.parentId, "nb1")
  assert.deepEqual(c1.content, [{ type: "p", children: [{ text: "正文1" }] }])
  assert.deepEqual(c1.tags, ["x"])
  assert.equal(c1.createdAt, 10)
  // 墓碑保留
  const c2 = plan!.puts.find((p) => p.id === "n2")!
  assert.equal(c2.parentId, "nb1")
  assert.equal(c2.deletedAt, 99)
  // notebook 待清除
  assert.deepEqual(plan!.deleteNotebookIds, ["nb1"])
  // nb1 下子笔记 sortKey 严格递增唯一
  childrenSorted(plan!.puts, "nb1")
  // 零丢数据: 3 个节点 (1 目录页 + 2 笔记)
  assert.equal(plan!.puts.length, 3)
})

test("根级混排: 目录页与未分组笔记同组, sortKey 不碰撞且目录页在前", () => {
  const notes = [
    {
      id: "u1",
      title: "未分组A",
      content: [],
      notebookId: null,
      tags: [],
      createdAt: 1,
      updatedAt: 100,
    },
    {
      id: "u2",
      title: "未分组B",
      content: [],
      notebookId: null,
      tags: [],
      createdAt: 2,
      updatedAt: 50,
    },
  ]
  const notebooks = [
    { id: "nbA", name: "本A", createdAt: 3 },
    { id: "nbB", name: "本B", createdAt: 4 },
  ]
  const plan = planNotesTreeMigration(notes, notebooks, NOW)!
  const roots = childrenSorted(plan.puts, null) // 内含唯一性 + 递增断言
  // 目录页 (nbA, nbB) 排在未分组笔记之前
  assert.deepEqual(
    roots.map((r) => r.id),
    ["nbA", "nbB", "u1", "u2"],
    "根级应 目录页(createdAt 升) 在前, 未分组笔记(updatedAt 降) 在后",
  )
})

test("孤儿笔记 (notebookId 指向不存在笔记本) 归根", () => {
  const notes = [
    {
      id: "o1",
      title: "孤儿",
      content: [],
      notebookId: "ghost",
      tags: [],
      createdAt: 1,
      updatedAt: 1,
    },
  ]
  const plan = planNotesTreeMigration(notes, [], NOW)!
  assert.equal(plan.puts.find((p) => p.id === "o1")!.parentId, null)
})

test("崩溃重跑: 已迁移节点不重建, 但仍返回待清旧笔记本 (幂等收尾)", () => {
  // 模拟: 上轮已写好 n1 (有 sortKey, parentId), 也已建好 nb1 目录页, 但 noteNotebooks 未清。
  const rawNotes = [
    {
      id: "nb1",
      title: "本子",
      content: [{ type: "p", children: [{ text: "" }] }],
      parentId: null,
      sortKey: "a0",
      tags: [],
      createdAt: 5,
      updatedAt: 5,
    },
    {
      id: "n1",
      title: "子",
      content: [],
      parentId: "nb1",
      sortKey: "a1",
      tags: [],
      createdAt: 10,
      updatedAt: 20,
    },
  ]
  const rawNotebooks = [{ id: "nb1", name: "本子", createdAt: 5 }]
  const plan = planNotesTreeMigration(rawNotes, rawNotebooks, NOW)!
  // 不重建 nb1 目录页 / n1 (它们已带 sortKey)
  assert.equal(plan.puts.length, 0, "已迁移节点不应被重建")
  // 仍清理残留的旧笔记本
  assert.deepEqual(plan.deleteNotebookIds, ["nb1"])
})

test("空笔记本 → 空根目录页", () => {
  const plan = planNotesTreeMigration([], [{ id: "empty", name: "空本", createdAt: 1 }], NOW)!
  const dir = plan.puts.find((p) => p.id === "empty")!
  assert.equal(dir.parentId, null)
  assert.equal(dir.title, "空本")
  assert.ok(Array.isArray(dir.content) && dir.content.length === 1, "空目录页应有空段落正文")
  assert.equal(plan.puts.filter((p) => p.parentId === "empty").length, 0)
})
