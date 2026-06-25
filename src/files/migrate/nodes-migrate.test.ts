// 折叠步 A「笔记播种进 nodes 仓库」回归网 (node:test + tsx)。纯本地无服务端备份, 故锁死:
//   - 零丢数据: 每条笔记原样成一个 kind:"note" 节点, 正文/标签/时间/sortKey/parentId 全保留;
//   - 墓碑保留: deletedAt 原样带出 (漏带 = 已删笔记复活);
//   - 幂等: 已播种 (id 在 nodes 仓库) → 不重写, 但仍返回 drain 清旧仓库 (崩溃重跑收尾);
//   - 空旧仓库 → null (无操作)。
import { test } from "node:test"
import assert from "node:assert/strict"

import {
  planNodesSeed,
  planBookmarksSeed,
  planFilesSeed,
  planFeedsSeed,
  planThreadsSeed,
  subToFeedNode,
  feedNodeToSub,
  feedNodeId,
} from "@/files/migrate/nodes-migrate"
import type { Subscription } from "@protocol/subscription"

const NOW = 1_700_000_000_000

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

test('全量播种: 每条加 kind:"note", 字段原样保留, 全部进 drain', () => {
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
  const plan = planNodesSeed(
    [{ title: "无 id" } as Record<string, unknown>, treeNote()],
    new Set(),
  )!
  assert.equal(plan.puts.length, 1)
  assert.deepEqual(plan.drainNoteIds, ["n1"])
})

// ---- 折叠步 B: 书签 + 收藏夹 ----

const rawBm = (over: Record<string, unknown> = {}) => ({
  id: "b1",
  title: "示例",
  url: "https://example.com",
  description: "描述",
  favicon: "https://example.com/favicon.ico",
  folderId: null,
  tags: ["t"],
  createdAt: 100,
  ...over,
})
const rawFolder = (over: Record<string, unknown> = {}) => ({
  id: "f1",
  name: "我的收藏夹",
  createdAt: 50,
  ...over,
})

test("书签播种: null = 两旧仓库都空", () => {
  assert.equal(planBookmarksSeed([], [], new Set(), NOW), null)
})

test("书签播种: 投影正确 (folderId→parentId, url 等收进 content, title/tags 留顶层)", () => {
  const plan = planBookmarksSeed([rawBm({ folderId: "f1" })], [rawFolder()], new Set(), NOW)!
  const folder = plan.puts.find((n) => n.id === "f1")!
  assert.equal(folder.kind, "folder")
  assert.equal(folder.title, "我的收藏夹")
  assert.equal(folder.parentId, null)
  assert.equal(folder.createdAt, 50)
  assert.equal(folder.updatedAt, 50) // updatedAt = createdAt
  const bm = plan.puts.find((n) => n.id === "b1")!
  assert.equal(bm.kind, "bookmark")
  assert.equal(bm.title, "示例")
  assert.equal(bm.parentId, "f1") // folderId→parentId
  assert.deepEqual(bm.tags, ["t"])
  assert.equal(bm.createdAt, 100)
  assert.equal(bm.updatedAt, 100)
  if (bm.kind === "bookmark") {
    assert.deepEqual(bm.content, {
      url: "https://example.com",
      description: "描述",
      favicon: "https://example.com/favicon.ico",
    })
  }
  // 零丢数据: drain 全量
  assert.deepEqual(plan.drainBookmarkIds, ["b1"])
  assert.deepEqual(plan.drainFolderIds, ["f1"])
})

test("书签播种: folderId 指向不存在收藏夹 → 归根 (parentId=null)", () => {
  const plan = planBookmarksSeed([rawBm({ folderId: "ghost" })], [], new Set(), NOW)!
  assert.equal(plan.puts.find((n) => n.id === "b1")!.parentId, null)
})

test("书签播种: 同 parentId 组内 sortKey 严格递增且唯一", () => {
  const bms = [
    rawBm({ id: "b1", createdAt: 10 }),
    rawBm({ id: "b2", createdAt: 20 }),
    rawBm({ id: "b3", createdAt: 30 }),
  ]
  const plan = planBookmarksSeed(bms, [], new Set(), NOW)!
  const keys = plan.puts
    .filter((n) => n.parentId === null)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((n) => n.sortKey)
  for (let i = 1; i < keys.length; i++) assert.ok(keys[i - 1] < keys[i], "sortKey 应严格递增")
  assert.equal(new Set(keys).size, keys.length, "sortKey 不得碰撞")
})

test("书签播种: 缺时间戳兜底 now; 缺字段归一空串", () => {
  const plan = planBookmarksSeed([{ id: "b1", url: "u" }], [], new Set(), NOW)!
  const bm = plan.puts.find((n) => n.id === "b1")!
  assert.equal(bm.createdAt, NOW)
  assert.equal(bm.updatedAt, NOW)
  assert.equal(bm.title, "u") // title 缺省回退 url
  if (bm.kind === "bookmark") assert.equal(bm.content.description, "")
})

test("书签播种: 幂等 — 已播种不重写, drain 仍全量收尾", () => {
  const plan = planBookmarksSeed(
    [rawBm({ id: "b1" }), rawBm({ id: "b2" })],
    [rawFolder({ id: "f1" })],
    new Set(["b1", "f1"]),
    NOW,
  )!
  assert.equal(
    plan.puts.find((n) => n.id === "b1"),
    undefined,
  )
  assert.equal(
    plan.puts.find((n) => n.id === "f1"),
    undefined,
  )
  assert.ok(plan.puts.find((n) => n.id === "b2"))
  assert.deepEqual(plan.drainBookmarkIds.sort(), ["b1", "b2"])
  assert.deepEqual(plan.drainFolderIds, ["f1"])
})

// ---- 折叠步 B 续: 文件 + Blob 旁存 ----

const rawFile = (over: Record<string, unknown> = {}) => ({
  id: "fl1",
  name: "图.png",
  type: "image/png",
  size: 1234,
  blob: new Blob(["binary"], { type: "image/png" }),
  createdAt: 200,
  tags: ["img"],
  ...over,
})

test("文件播种: null = 旧仓库空", () => {
  assert.equal(planFilesSeed([], new Set(), NOW), null)
})

test("文件播种: 节点存 blobRef (二进制拆到旁存), 投影正确", () => {
  const plan = planFilesSeed([rawFile()], new Set(), NOW)!
  const node = plan.nodePuts.find((n) => n.id === "fl1")!
  assert.equal(node.kind, "file")
  assert.equal(node.title, "图.png")
  assert.equal(node.parentId, null)
  assert.deepEqual(node.tags, ["img"])
  assert.equal(node.createdAt, 200)
  assert.equal(node.updatedAt, 200)
  if (node.kind === "file") {
    assert.equal(node.blobRef.store, "blobs")
    assert.equal(node.blobRef.key, "fl1") // blobRef.key = 文件 id
    assert.equal(node.blobRef.size, 1234)
    assert.equal(node.blobRef.mime, "image/png")
  }
  // Blob 旁存, 节点不含二进制
  assert.equal(plan.blobPuts.length, 1)
  assert.equal(plan.blobPuts[0].key, "fl1")
  assert.ok(plan.blobPuts[0].blob instanceof Blob)
  assert.equal(JSON.stringify(node).includes("Blob"), false)
  // 零丢数据: drain 全量
  assert.deepEqual(plan.drainFileIds, ["fl1"])
})

test("文件播种: 缺 Blob 的脏记录仍迁节点 (不丢元数据), 跳过 blob 旁存; size 回退", () => {
  const plan = planFilesSeed([rawFile({ blob: undefined, size: 0 })], new Set(), NOW)!
  assert.ok(plan.nodePuts.find((n) => n.id === "fl1"))
  assert.equal(plan.blobPuts.length, 0)
})

test("文件播种: 同级 sortKey 严格递增且唯一", () => {
  const files = [
    rawFile({ id: "a", createdAt: 10 }),
    rawFile({ id: "b", createdAt: 20 }),
    rawFile({ id: "c", createdAt: 30 }),
  ]
  const plan = planFilesSeed(files, new Set(), NOW)!
  const keys = plan.nodePuts.sort((x, y) => x.createdAt - y.createdAt).map((n) => n.sortKey)
  for (let i = 1; i < keys.length; i++) assert.ok(keys[i - 1] < keys[i], "sortKey 应严格递增")
  assert.equal(new Set(keys).size, keys.length, "sortKey 不得碰撞")
})

test("文件播种: 幂等 — 已播种的节点与 blob 都不重写, drain 全量收尾", () => {
  const plan = planFilesSeed(
    [rawFile({ id: "fl1" }), rawFile({ id: "fl2" })],
    new Set(["fl1"]),
    NOW,
  )!
  assert.equal(
    plan.nodePuts.find((n) => n.id === "fl1"),
    undefined,
  )
  assert.equal(
    plan.blobPuts.find((b) => b.key === "fl1"),
    undefined,
  )
  assert.ok(plan.nodePuts.find((n) => n.id === "fl2"))
  assert.deepEqual(plan.drainFileIds.sort(), ["fl1", "fl2"])
})

// ---- 折叠步 C: 订阅 → feed 节点 ----

const rawSub = (over: Record<string, unknown> = {}) => ({
  id: "publisher:example.com",
  type: "publisher",
  key: "example.com",
  title: "示例站",
  favicon: "https://example.com/fav.ico",
  createdAt: 300,
  updatedAt: 350,
  ...over,
})

test("订阅播种: null = 旧仓库空", () => {
  assert.equal(planFeedsSeed([], new Set(), NOW), null)
})

test("订阅播种: 确定性 id feed:type:key (绝不 genId)", () => {
  const plan = planFeedsSeed([rawSub()], new Set(), NOW)!
  assert.equal(plan.puts[0].id, "feed:publisher:example.com")
  assert.equal(plan.puts[0].id, feedNodeId("publisher", "example.com"))
  // drain 用旧 wire id (type:key)
  assert.deepEqual(plan.drainSubIds, ["publisher:example.com"])
})

test("订阅播种: content 投影 (type/key/favicon + entity 专属字段)", () => {
  const plan = planFeedsSeed(
    [
      rawSub({
        id: "entity:PER/张三",
        type: "entity",
        key: "PER/张三",
        entityLabel: "PER",
        entityName: "张三",
      }),
    ],
    new Set(),
    NOW,
  )!
  const node = plan.puts[0]
  assert.equal(node.kind, "feed")
  assert.equal(node.id, "feed:entity:PER/张三")
  if (node.kind === "feed") {
    assert.equal(node.content.type, "entity")
    assert.equal(node.content.key, "PER/张三")
    assert.equal(node.content.entityLabel, "PER")
    assert.equal(node.content.entityName, "张三")
    assert.equal(node.content.searchKeyword, undefined) // 非 search 不带
  }
})

test("订阅播种: 含墓碑全量带过来 (deletedAt 保留, 防已删订阅复活)", () => {
  const plan = planFeedsSeed([rawSub({ deletedAt: 999 })], new Set(), NOW)!
  assert.equal(plan.puts[0].deletedAt, 999)
})

test("订阅投影 round-trip 无损: feedNodeToSub(subToFeedNode(sub)) === sub", () => {
  const subs: Subscription[] = [
    {
      id: "publisher:a.com",
      type: "publisher",
      key: "a.com",
      title: "A",
      favicon: "f",
      createdAt: 1,
      updatedAt: 2,
    },
    {
      id: "entity:PER/李四",
      type: "entity",
      key: "PER/李四",
      title: "李四",
      favicon: "",
      entityLabel: "PER",
      entityName: "李四",
      createdAt: 3,
      updatedAt: 4,
    },
    {
      id: "search:foo",
      type: "search",
      key: "foo",
      title: "搜 foo",
      favicon: "",
      searchKeyword: "foo",
      searchDomain: "x.com",
      createdAt: 5,
      updatedAt: 6,
      deletedAt: 7, // 墓碑也须无损
    },
  ]
  for (const sub of subs) {
    assert.deepEqual(feedNodeToSub(subToFeedNode(sub, "a0")), sub)
  }
})

test("订阅播种: 同级 sortKey 严格递增唯一; 幂等 (已播种不重写, drain 全量)", () => {
  const subs = [
    rawSub({ id: "publisher:a", key: "a", createdAt: 10 }),
    rawSub({ id: "publisher:b", key: "b", createdAt: 20 }),
  ]
  const plan = planFeedsSeed(subs, new Set(["feed:publisher:a"]), NOW)!
  // 已播种 feed:publisher:a 不重写
  assert.equal(
    plan.puts.find((n) => n.id === "feed:publisher:a"),
    undefined,
  )
  assert.ok(plan.puts.find((n) => n.id === "feed:publisher:b"))
  // drain 全量 (旧 wire id)
  assert.deepEqual(plan.drainSubIds.sort(), ["publisher:a", "publisher:b"])
  // 全量重跑时 sortKey 递增唯一
  const full = planFeedsSeed(subs, new Set(), NOW)!
  const keys = full.puts.sort((a, b) => a.createdAt - b.createdAt).map((n) => n.sortKey)
  for (let i = 1; i < keys.length; i++) assert.ok(keys[i - 1] < keys[i])
  assert.equal(new Set(keys).size, keys.length)
})

// ---- 折叠步 D: 线程 ----

const rawThread = (over: Record<string, unknown> = {}) => ({
  id: "t1",
  title: "对话一",
  messages: [
    { id: "m1", role: "user", content: "你好", createdAt: 1 },
    { id: "m2", role: "assistant", content: "在", createdAt: 2 },
  ],
  createdAt: 400,
  updatedAt: 450,
  ...over,
})

test("线程播种: null = 旧仓库空", () => {
  assert.equal(planThreadsSeed([], new Set(), NOW), null)
})

test("线程播种: messages 原样透传进 content (协议不解读语义), 字段保留", () => {
  const plan = planThreadsSeed([rawThread()], new Set(), NOW)!
  const node = plan.puts.find((n) => n.id === "t1")!
  assert.equal(node.kind, "thread")
  assert.equal(node.title, "对话一")
  assert.equal(node.parentId, null)
  assert.equal(node.createdAt, 400)
  assert.equal(node.updatedAt, 450)
  if (node.kind === "thread") {
    assert.equal(node.content.messages.length, 2)
    assert.deepEqual(node.content.messages[0], {
      id: "m1",
      role: "user",
      content: "你好",
      createdAt: 1,
    })
  }
  assert.deepEqual(plan.drainThreadIds, ["t1"])
})

test("线程播种: 缺 messages / 标题兜底; 同级 sortKey 递增唯一", () => {
  const plan = planThreadsSeed(
    [
      { id: "a", createdAt: 10 },
      { id: "b", createdAt: 20, title: "B" },
    ],
    new Set(),
    NOW,
  )!
  const a = plan.puts.find((n) => n.id === "a")!
  assert.equal(a.title, "新对话") // 缺标题兜底
  if (a.kind === "thread") assert.deepEqual(a.content.messages, []) // 缺 messages → 空
  const keys = plan.puts.sort((x, y) => x.createdAt - y.createdAt).map((n) => n.sortKey)
  for (let i = 1; i < keys.length; i++) assert.ok(keys[i - 1] < keys[i])
  assert.equal(new Set(keys).size, keys.length)
})

test("线程播种: 幂等 — 已播种不重写, drain 全量收尾 (线程无墓碑, 硬删)", () => {
  const plan = planThreadsSeed(
    [rawThread({ id: "t1" }), rawThread({ id: "t2" })],
    new Set(["t1"]),
    NOW,
  )!
  assert.equal(
    plan.puts.find((n) => n.id === "t1"),
    undefined,
  )
  assert.ok(plan.puts.find((n) => n.id === "t2"))
  assert.deepEqual(plan.drainThreadIds.sort(), ["t1", "t2"])
})
