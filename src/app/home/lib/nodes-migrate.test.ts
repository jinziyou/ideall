// 折叠步 A「笔记播种进 nodes 仓库」回归网 (node:test + tsx)。纯本地无服务端备份, 故锁死:
//   - 零丢数据: 每条笔记原样成一个 kind:"note" 节点, 正文/标签/时间/sortKey/parentId 全保留;
//   - 墓碑保留: deletedAt 原样带出 (漏带 = 已删笔记复活);
//   - 幂等: 已播种 (id 在 nodes 仓库) → 不重写, 但仍返回 drain 清旧仓库 (崩溃重跑收尾);
//   - 空旧仓库 → null (无操作)。
import { test } from "node:test"
import assert from "node:assert/strict"

import { planNodesSeed } from "./nodes-migrate"

const treeNote = (over: Record<string, unknown> = {}) => ({
  id: "n1",
  title: "笔记一",
  content: [{ type: "p", children: [{ text: "正文" }] }],
  parentId: null,
  sortKey: "a0",
  tags: ["x"],
  createdAt: 10,
  updatedAt: 20,
  ...over,
})

test("空旧仓库 → null (无操作)", () => {
  assert.equal(planNodesSeed([], new Set()), null)
})

test("全量播种: 每条加 kind:\"note\", 字段原样保留, 全部进 drain", () => {
  const notes = [
    treeNote(),
    treeNote({ id: "n2", title: "笔记二", parentId: "n1", sortKey: "a1", tags: [], updatedAt: 30 }),
  ]
  const plan = planNodesSeed(notes, new Set())!
  assert.ok(plan)
  assert.equal(plan.puts.length, 2)
  const p1 = plan.puts.find((p) => p.id === "n1")!
  assert.equal(p1.kind, "note")
  assert.equal(p1.title, "笔记一")
  assert.equal(p1.parentId, null)
  assert.equal(p1.sortKey, "a0")
  assert.deepEqual(p1.tags, ["x"])
  assert.deepEqual(p1.content, [{ type: "p", children: [{ text: "正文" }] }])
  assert.equal(p1.createdAt, 10)
  assert.equal(p1.updatedAt, 20)
  const p2 = plan.puts.find((p) => p.id === "n2")!
  assert.equal(p2.parentId, "n1")
  // 零丢数据: 两条都进 drain (播种后清空旧仓库)
  assert.deepEqual(plan.drainNoteIds.sort(), ["n1", "n2"])
})

test("墓碑保留: deletedAt 原样带出 (不复活已删笔记)", () => {
  const plan = planNodesSeed([treeNote({ id: "dead", deletedAt: 99, content: [] })], new Set())!
  const dead = plan.puts.find((p) => p.id === "dead")!
  assert.equal(dead.kind, "note")
  assert.equal(dead.deletedAt, 99)
})

test("幂等: 已播种的 id 不重写, 但仍返回 drain 收尾清旧仓库", () => {
  // 模拟上轮已把 n1 播种进 nodes (含播种后的本地编辑), 但旧仓库 drain 未完成 → 重跑。
  const notes = [treeNote({ title: "旧标题" }), treeNote({ id: "n2", sortKey: "a1" })]
  const plan = planNodesSeed(notes, new Set(["n1"]))!
  // n1 已存在 → 不重写 (不会用旧仓库的「旧标题」覆盖 nodes 里的新版本)
  assert.equal(
    plan.puts.find((p) => p.id === "n1"),
    undefined,
  )
  // n2 仍未播种 → 写入
  assert.ok(plan.puts.find((p) => p.id === "n2"))
  // drain 仍含全部 (收尾清空旧仓库)
  assert.deepEqual(plan.drainNoteIds.sort(), ["n1", "n2"])
})

test("全部已播种: puts 为空, drain 仍完整 (纯收尾)", () => {
  const notes = [treeNote(), treeNote({ id: "n2" })]
  const plan = planNodesSeed(notes, new Set(["n1", "n2"]))!
  assert.equal(plan.puts.length, 0)
  assert.deepEqual(plan.drainNoteIds.sort(), ["n1", "n2"])
})

test("脏记录 (无 id) 跳过: 既不播种也不 drain, 不丢", () => {
  const plan = planNodesSeed([{ title: "无 id" } as Record<string, unknown>, treeNote()], new Set())!
  assert.equal(plan.puts.length, 1)
  assert.deepEqual(plan.drainNoteIds, ["n1"])
})
