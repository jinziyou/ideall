// 对话即文件 (§6.5) 回归：gatherReferencedContext 只供显式生成精确提示；普通发送使用可见托盘的
// gatherSelectedContext。宿主全量读仍经 FilesPort，不改 agent 的 MCP 授权集。
import { test } from "node:test"
import assert from "node:assert/strict"
import { registerFilesPort, type FilesPort } from "@protocol/files"
import type { Node } from "@protocol/node"
import { registerActiveNode } from "@/lib/active-node"
import { nodeAgentContextSource, urlAgentContextSource } from "@/lib/agent-context-tray"
import {
  buildSystemPrompt,
  gatherHomeContext,
  gatherReferencedContext,
  gatherSelectedContext,
} from "./agent-context"

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

test("上下文托盘: 只返回成功读取的显式来源并注入来源标记", async () => {
  const bookmark: Node = {
    id: "b1",
    kind: "bookmark",
    title: "Source",
    parentId: null,
    sortKey: "a1",
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    content: {
      url: "https://example.com/source",
      description: "Primary evidence",
      favicon: "",
    },
  }
  mockGetNode({ n1: noteWithBody, b1: bookmark })
  const external = urlAgentContextSource("https://example.com/external", "External")
  assert.ok(external)

  const prepared = await gatherSelectedContext([
    nodeAgentContextSource("note", "n1", "方案"),
    nodeAgentContextSource("bookmark", "b1", "Source"),
    nodeAgentContextSource("note", "missing", "Missing"),
    external!,
  ])

  assert.deepEqual(
    prepared.sources.map((source) => source.title),
    ["方案", "Source", "External"],
  )
  assert.match(prepared.text, /\[来源 node:note:n1\]/)
  assert.match(prepared.text, /私密正文/)
  assert.match(prepared.text, /Primary evidence/)
  assert.doesNotMatch(prepared.text, /Missing/)
  assert.match(buildSystemPrompt("", { selected: prepared.text }), /明确加入上下文托盘/)
})
