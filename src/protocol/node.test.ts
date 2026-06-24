// 统一 Node 隐私净化回归网 (node:test + tsx)。锁死 §6.3: 批量列举 (fs.list / fs://nodes) 永不回
// note 正文与 thread 会话; 其余 kind 原样。stripNode 漏剥 = AI 批量读到私密正文/对话 (隐私事故)。
import { test } from "node:test"
import assert from "node:assert/strict"

import { stripNode, isNodeKind, type Node } from "./node"

const base = { id: "x", parentId: null, sortKey: "a0", title: "T", tags: [], createdAt: 1, updatedAt: 1 }

test("stripNode: note 剥正文 content (title 等元数据保留)", () => {
  const note: Node = { ...base, kind: "note", content: [{ type: "p", children: [{ text: "私密正文" }] }] }
  const s = stripNode(note)
  assert.equal(s.kind, "note")
  assert.equal(s.title, "T")
  if (s.kind === "note") assert.deepEqual(s.content, [])
  // 原对象不被改 (纯函数)
  if (note.kind === "note") assert.equal(note.content.length, 1)
})

test("stripNode: thread 剥 messages (会话私密)", () => {
  const thread: Node = { ...base, kind: "thread", content: { messages: [{ role: "user", content: "秘密" }] } }
  const s = stripNode(thread)
  if (s.kind === "thread") assert.deepEqual(s.content.messages, [])
})

test("stripNode: bookmark/feed/file/folder 原样 (content 非私密正文)", () => {
  const bm: Node = { ...base, kind: "bookmark", content: { url: "https://x", description: "d", favicon: "" } }
  assert.deepEqual(stripNode(bm), bm)
  const feed: Node = { ...base, kind: "feed", content: { type: "publisher", key: "x.com", favicon: "" } }
  assert.deepEqual(stripNode(feed), feed)
  const folder: Node = { ...base, kind: "folder", content: null }
  assert.deepEqual(stripNode(folder), folder)
})

test("isNodeKind: 合法 kind true, 其余 false", () => {
  for (const k of ["folder", "note", "bookmark", "file", "feed", "thread"]) assert.ok(isNodeKind(k))
  assert.equal(isNodeKind("bogus"), false)
})
