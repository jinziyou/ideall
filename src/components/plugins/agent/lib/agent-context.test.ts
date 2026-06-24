// 对话即文件 (§6.5) 回归: gatherReferencedContext 把"当前查看的 note/thread"内容注入上下文 (隐式 consent),
// 其余 kind 不注入 (概览已覆盖)。宿主全量读 (HubDataPort), 不改 agent 的 MCP 授权集。
import { test } from "node:test"
import assert from "node:assert/strict"
import { registerHubData, type HubDataPort } from "@protocol/hub-data"
import type { Node } from "@protocol/node"
import { registerActiveNode } from "@/components/lib/active-node"
import { gatherReferencedContext } from "./agent-context"

function mockGetNode(nodes: Record<string, Node>) {
  registerHubData({
    fsGetNode: async (id: string) => nodes[id],
  } as unknown as HubDataPort)
}

const noteWithBody: Node = {
  id: "n1",
  kind: "note",
  title: "方案",
  parentId: null,
  sortKey: "a0",
  tags: [],
  createdAt: 1,
  updatedAt: 1,
  content: [{ type: "p", children: [{ text: "这是当前笔记的私密正文" }] }],
}

test("激活 note → 注入正文 (标题 + 正文文本)", async () => {
  mockGetNode({ n1: noteWithBody })
  registerActiveNode(() => ({ kind: "note", id: "n1" }))
  const ctx = await gatherReferencedContext()
  assert.ok(ctx.includes("方案"), "应含标题")
  assert.ok(ctx.includes("这是当前笔记的私密正文"), "应含正文")
})

test("无激活节点 → 空串", async () => {
  mockGetNode({})
  registerActiveNode(() => null)
  assert.equal(await gatherReferencedContext(), "")
})

test("激活 bookmark → 空串 (非 note/thread, 概览已覆盖, 不注入)", async () => {
  mockGetNode({})
  registerActiveNode(() => ({ kind: "bookmark", id: "b1" }))
  assert.equal(await gatherReferencedContext(), "")
})

test("激活 thread → 注入近期会话", async () => {
  const thread: Node = {
    id: "t1",
    kind: "thread",
    title: "上次讨论",
    parentId: null,
    sortKey: "a0",
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    content: { messages: [{ role: "user", content: "怎么做" }, { role: "assistant", content: "先这样" }] },
  }
  mockGetNode({ t1: thread })
  registerActiveNode(() => ({ kind: "thread", id: "t1" }))
  const ctx = await gatherReferencedContext()
  assert.ok(ctx.includes("先这样"), "应含会话内容")
})
