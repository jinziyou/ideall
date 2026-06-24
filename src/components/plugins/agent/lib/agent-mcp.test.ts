// agent ↔ 统一能力层 端到端回归 (node:test + tsx): 经 LoopbackTransport 起真实 MCP server(agentGrant)+client,
// 锁死 §6 隐私/权限不变量穿过完整链路 —— tools/list 只暴露授权工具; fs.read(note) 无 consent 报错; fs.list 剥正文。
import { test } from "node:test"
import assert from "node:assert/strict"
import { registerHubData, type HubDataPort } from "@protocol/hub-data"
import type { Node } from "@protocol/node"
import { registerUiActions } from "@/components/lib/ui-actions"
import { connectAgentMcp } from "./agent-mcp"

const noop = () => {
  throw new Error("不应触达")
}

function registerMock(nodes: Record<string, Node>) {
  const hub = {
    fsListNodes: async (kinds: string[]) =>
      Object.values(nodes).filter((n) => kinds.includes(n.kind) && n.deletedAt == null),
    fsGetNode: async (id: string) => {
      const n = nodes[id]
      return n && n.deletedAt == null ? n : undefined
    },
    fsCreateNode: noop,
    fsUpdateNode: noop,
    fsMoveNode: noop,
    fsDeleteNode: noop,
    fsReadBlob: noop,
    // 其余方法本测不触达
  } as unknown as HubDataPort
  registerHubData(hub)
  registerUiActions({ openTab: () => {}, closeTab: () => {} })
}

const noteNode = (id: string): Node => ({
  id,
  kind: "note",
  title: `笔记 ${id}`,
  parentId: null,
  sortKey: "a0",
  tags: [],
  createdAt: 1,
  updatedAt: 1,
  content: [{ type: "p", children: [{ text: "私密正文不应批量外发" }] }],
})

test("tools/list 只暴露 agentGrant 授权工具 (fs.*/ui.*; 不含 hub.*/identity)", async () => {
  registerMock({})
  const mcp = await connectAgentMcp()
  const names = mcp.tools.map((t) => t.function.name)
  for (const n of ["fs.list", "fs.read", "fs.create", "fs.write", "fs.delete", "ui.openTab"]) {
    assert.ok(names.includes(n), `应暴露 ${n}`)
  }
  assert.ok(!names.includes("hub.addBookmark"), "无 hub.bookmarks:write → 不暴露 hub.addBookmark")
  assert.ok(!names.includes("identity.me"), "无 identity:read → 不暴露 identity.me")
  await mcp.close()
})

test("fs.read(note) 在 agent (无 fs.notes:read) → consent-required", async () => {
  registerMock({ n1: noteNode("n1") })
  const mcp = await connectAgentMcp()
  const r = await mcp.callTool("fs.read", { kind: "note", id: "n1" })
  assert.equal(r.ok, false)
  assert.equal((r.data as { message?: string }).message, "consent-required")
  await mcp.close()
})

test("fs.list(note) 剥正文 (只回标题元数据, 即便经 agent)", async () => {
  registerMock({ n1: noteNode("n1") })
  const mcp = await connectAgentMcp()
  const r = await mcp.callTool("fs.list", { kind: "note" })
  assert.equal(r.ok, true)
  const items = r.data as { kind: string; title: string; content: unknown[] }[]
  assert.equal(items.length, 1)
  assert.equal(items[0].title, "笔记 n1")
  assert.deepEqual(items[0].content, [], "fs.list 必须剥掉 note 正文")
  await mcp.close()
})
