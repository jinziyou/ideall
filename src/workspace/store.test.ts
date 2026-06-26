// 工作区标签「激活来源」单测 (node:test + tsx): 守 agent 经 ui.openTab 自激活不计入隐式同意 (隐私)。
// 背景: active-node 端口仅对 source==="user" 的激活节点回 NodeRef; agent 自激活回 null ——
// 防 agent ui.openTab 任意笔记 → 下一轮 referenced-context 自喂其正文给模型 (软绕 fs.notes:read consent)。
import { test } from "node:test"
import assert from "node:assert/strict"

import { openNodeTab, setActiveTab, getActiveId, getActiveSource } from "./store"

test("openNodeTab 默认来源 user; 传 agent 标记 agent", () => {
  openNodeTab({ kind: "note", id: "u1" }, "用户开")
  assert.equal(getActiveSource(), "user")
  openNodeTab({ kind: "note", id: "a1" }, "AI 开", "agent")
  assert.equal(getActiveSource(), "agent", "agent 经 ui.openTab 自激活 → 来源 agent")
})

test("用户点回 agent 开的标签 → 来源转 user (用户主动看 = 同意)", () => {
  openNodeTab({ kind: "note", id: "x" }, "X", "agent")
  assert.equal(getActiveSource(), "agent")
  const id = getActiveId()
  assert.ok(id)
  setActiveTab(id!)
  assert.equal(getActiveSource(), "user", "用户点击该标签 → 视作同意")
})

test("用户经侧栏/搜索再开别的节点 → 来源回 user (不被前一个 agent 态污染)", () => {
  openNodeTab({ kind: "note", id: "a2" }, "AI 开2", "agent")
  assert.equal(getActiveSource(), "agent")
  openNodeTab({ kind: "file", id: "f1" }, "用户开文件") // 默认 user
  assert.equal(getActiveSource(), "user")
})
