// 对话即文件 (§6.5) 回归: gatherReferencedContext 把"当前查看的 note/thread"内容注入上下文 (隐式 consent),
// 其余 kind 不注入 (概览已覆盖)。宿主全量读 (FilesPort), 不改 agent 的 MCP 授权集。
import { test } from "node:test"
import assert from "node:assert/strict"
import { registerFilesPort, type FilesPort } from "@protocol/files"
import type { Node } from "@protocol/node"
import { registerActiveNode } from "@/lib/active-node"
import { gatherHomeContext, gatherReferencedContext } from "./agent-context"

function mockGetNode(nodes: Record<string, Node>) {
  registerFilesPort({
    fsGetNode: async (id: string) => nodes[id],
  } as unknown as FilesPort)
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
    content: {
      messages: [
        { role: "user", content: "怎么做" },
        { role: "assistant", content: "先这样" },
      ],
    },
  }
  mockGetNode({ t1: thread })
  registerActiveNode(() => ({ kind: "thread", id: "t1" }))
  const ctx = await gatherReferencedContext()
  assert.ok(ctx.includes("先这样"), "应含会话内容")
})

test("home 上下文: 分项读取失败时标记失败来源, 不伪装为空", async () => {
  registerFilesPort({
    listSubscriptions: async () => [],
    listBookmarks: async () => [],
    listFolders: async () => [],
    listFiles: async () => [],
    listNotes: async () => {
      throw new Error("blocked")
    },
  } as unknown as FilesPort)
  const ctx = await gatherHomeContext()
  assert.ok(ctx.includes("上下文读取状态"), "应包含上下文状态")
  assert.ok(ctx.includes("我的笔记"), "应指出失败来源")
  assert.ok(ctx.includes("不能据此判断为空"), "应避免误判为空数据")
})
