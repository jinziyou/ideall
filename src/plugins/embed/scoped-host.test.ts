// ScopedFiles 收窄句柄单测 (node:test + tsx): note/thread 正文须 canReadNotes 才可达。
// 把私密读闸从「fs.read 单个 handler」下沉到 host.files 后, 这里直接守它 (无需起 McpServer)。
import { test } from "node:test"
import assert from "node:assert/strict"

import { makeScopedFiles } from "./scoped-host"
import type { Node, NodeOfKind } from "@protocol/node"
import type { FilesPort } from "@protocol/files"

const base = {
  id: "n",
  parentId: null,
  sortKey: "a0",
  title: "T",
  tags: [],
  createdAt: 1,
  updatedAt: 1,
}
const note: Node = {
  ...base,
  id: "n",
  kind: "note",
  content: [{ type: "p", children: [{ text: "私密正文" }] }],
}
const thread: Node = {
  ...base,
  id: "t",
  kind: "thread",
  content: { messages: [{ role: "user", content: "秘" }] },
}
const bm: Node = {
  ...base,
  id: "b",
  kind: "bookmark",
  content: { url: "https://x", description: "d", favicon: "" },
}

/** 只实现 makeScopedFiles 实际调用的方法; 其余 FilesPort 面不被触及, 故 cast。 */
function fakePort(): FilesPort {
  const all: Node[] = [note, thread, bm]
  const byId = new Map(all.map((n) => [n.id, n]))
  const f = {
    fsListNodes: async (kinds: string[]) => all.filter((n) => kinds.includes(n.kind)),
    fsGetNode: async (id: string) => byId.get(id),
    fsCreateNode: async (input: { kind: string; content?: unknown }) =>
      ({ ...base, id: "new", kind: input.kind, content: input.content }) as Node,
    fsUpdateNode: async (_k: string, id: string) => byId.get(id),
    fsMoveNode: async (_k: string, id: string) => byId.get(id),
    fsDeleteNode: async () => {},
    fsReadBlob: async () => ({ mime: "x", size: 0, base64: "" }),
    isSubscribed: async () => true,
    listSubscriptions: async () => ["SUBS"],
    addSubscription: async (i: unknown) => i,
    removeSubscription: async () => {},
    listBookmarks: async () => [],
    addBookmark: async (i: unknown) => i,
  }
  return f as unknown as FilesPort
}

const noteContent = (n: Node) => (n as NodeOfKind<"note">).content
const threadMsgs = (n: Node) => (n as NodeOfKind<"thread">).content.messages

test("listStripped: 一律剥 note/thread 内容 (即便 canReadNotes), bookmark 原样", async () => {
  const files = makeScopedFiles(fakePort(), true)
  const nodes = await files.listStripped(["note", "thread", "bookmark"])
  assert.deepEqual(noteContent(nodes.find((x) => x.kind === "note")!), [])
  assert.deepEqual(threadMsgs(nodes.find((x) => x.kind === "thread")!), [])
  assert.deepEqual(
    nodes.find((x) => x.kind === "bookmark"),
    bm,
  )
})

test("readGated: note/thread 无 notes-read → 'gated'", async () => {
  const files = makeScopedFiles(fakePort(), false)
  assert.equal(await files.readGated("n", "note"), "gated")
  assert.equal(await files.readGated("t", "thread"), "gated")
})

test("readGated: note 有 notes-read → 回全文", async () => {
  const full = await makeScopedFiles(fakePort(), true).readGated("n", "note")
  assert.ok(full && full !== "gated") // 收窄 full → Node
  assert.equal(noteContent(full).length, 1)
})

test("readGated: bookmark 不受闸; kind 不符 / 不存在 → null", async () => {
  const files = makeScopedFiles(fakePort(), false)
  const b = await files.readGated("b", "bookmark")
  assert.ok(b && b !== "gated")
  assert.equal(await files.readGated("n", "bookmark"), null) // kind 不符
  assert.equal(await files.readGated("zzz", "note"), null) // 不存在
})

test("createNode: 无 notes-read 回读剥 note 正文; 有则全文", async () => {
  const input = { kind: "note" as const, content: [{ type: "p", children: [{ text: "x" }] }] }
  assert.deepEqual(noteContent(await makeScopedFiles(fakePort(), false).createNode(input)), [])
  assert.equal(noteContent(await makeScopedFiles(fakePort(), true).createNode(input)).length, 1)
})

test("非私密直通: listSubscriptions 透传底层端口", async () => {
  assert.deepEqual(await makeScopedFiles(fakePort(), false).listSubscriptions(), ["SUBS"])
})
