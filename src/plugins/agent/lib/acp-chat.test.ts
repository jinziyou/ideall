import { test } from "node:test"
import assert from "node:assert/strict"
import type { PermissionOption, SessionUpdate } from "@agentclientprotocol/sdk"
import { EMPTY_TURN, foldAcpUpdate, turnToolEvents, pickPermissionOption } from "./acp-chat"

test("折叠: 文本块累加 + 工具调用按状态更新", () => {
  const updates: SessionUpdate[] = [
    { sessionUpdate: "tool_call", toolCallId: "tc-1", title: "读取文件", status: "in_progress" },
    { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "你好" } },
    { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "世界" } },
    { sessionUpdate: "tool_call_update", toolCallId: "tc-1", status: "completed" },
    { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "(思考, 忽略)" } },
  ]
  const turn = updates.reduce(foldAcpUpdate, EMPTY_TURN)
  assert.equal(turn.text, "你好世界")
  assert.equal(turn.tools.length, 1)
  assert.equal(turn.tools[0].status, "completed")
  assert.equal(turn.tools[0].title, "读取文件")
})

test("折叠不可变: 不改原 turn", () => {
  const next = foldAcpUpdate(EMPTY_TURN, {
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: "x" },
  })
  assert.equal(EMPTY_TURN.text, "")
  assert.equal(next.text, "x")
})

test("turnToolEvents 投影: failed → ok=false, 状态中文化", () => {
  const turn = foldAcpUpdate(EMPTY_TURN, {
    sessionUpdate: "tool_call",
    toolCallId: "t",
    title: "写入",
    status: "failed",
  })
  const evs = turnToolEvents(turn)
  assert.equal(evs.length, 1)
  assert.equal(evs[0].name, "写入")
  assert.equal(evs[0].ok, false)
  assert.equal(evs[0].summary, "失败")
})

test("pickPermissionOption: deny→null; allow→优先 allow_once", () => {
  const options: PermissionOption[] = [
    { optionId: "rej", name: "拒绝", kind: "reject_once" },
    { optionId: "ok1", name: "允许一次", kind: "allow_once" },
    { optionId: "okA", name: "总是允许", kind: "allow_always" },
  ]
  assert.equal(pickPermissionOption(options, false), null)
  assert.equal(pickPermissionOption(options, true)?.optionId, "ok1")
})

test("pickPermissionOption: 无 allow_once 时退任一 allow_*", () => {
  const options: PermissionOption[] = [
    { optionId: "rej", name: "拒绝", kind: "reject_once" },
    { optionId: "okA", name: "总是允许", kind: "allow_always" },
  ]
  assert.equal(pickPermissionOption(options, true)?.optionId, "okA")
})
