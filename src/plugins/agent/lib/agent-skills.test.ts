import assert from "node:assert/strict"
import { test } from "node:test"
import { decodeAgentSkills } from "./agent-config-codecs"
import { BUILTIN_SKILLS, replaceSkills, resolveSkills } from "./agent-skills"

test("research skills: comparison, summary, timeline and report require explicit sources", () => {
  const expected = new Map([
    ["summarize-sources", 1],
    ["compare-sources", 2],
    ["timeline-sources", 1],
    ["research-report", 2],
  ])
  for (const [id, minimum] of expected) {
    const skill = BUILTIN_SKILLS.find((candidate) => candidate.id === id)
    assert.ok(skill, `missing ${id}`)
    assert.equal(skill.minContextItems, minimum)
    assert.match(skill.prompt, /\[来源 key\]/)
    assert.equal(skill.invocation, "manual")
  }
})

test("skill codec: accepts only bounded safe explicit-context requirements", () => {
  const base = {
    id: "research",
    label: "研究",
    hint: "研究资料",
    prompt: "分析",
    enabled: true,
    invocation: "manual",
  }
  assert.equal(decodeAgentSkills([{ ...base, minContextItems: 2 }])[0]?.minContextItems, 2)
  for (const minContextItems of [0, 1.5, 9]) {
    assert.throws(() => decodeAgentSkills([{ ...base, minContextItems }]), /minContextItems/)
  }
})

test("skill registry: restoring an older/custom snapshot adds newly shipped builtins", () => {
  replaceSkills([
    {
      id: "custom",
      label: "自定义",
      hint: "自定义流程",
      prompt: "执行",
      enabled: true,
      invocation: "manual",
    },
  ])
  const restored = resolveSkills(null)
  assert.ok(restored.some((skill) => skill.id === "research-report" && skill.builtin))
  assert.ok(restored.some((skill) => skill.id === "custom" && !skill.builtin))
})
