// 单元: 「可用技能」段注入系统提示 —— auto 技能在普通对话也被模型感知 (功能: 技能感知)。
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorkspaceSegments, assembleSystemPrompt } from "./agent-context"

test("可用技能段: 技能名/描述注入, 默认模板生效", () => {
  const seg = buildWorkspaceSegments({
    tools: false,
    homeContext: "",
    skills: [{ name: "关注速览", description: "给条速览" }],
  })
  assert.match(seg.skills, /关注速览/)
  assert.match(seg.skills, /给条速览/)
  const sys = assembleSystemPrompt(seg) // 默认模板含 {{skills}}
  assert.match(sys, /关注速览/, "默认模板应注入技能段")
})

test("无技能 → 技能段为空", () => {
  const seg = buildWorkspaceSegments({ tools: false, homeContext: "" })
  assert.equal(seg.skills, "")
})
