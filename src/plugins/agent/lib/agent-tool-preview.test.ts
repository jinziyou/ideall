import assert from "node:assert/strict"
import { test } from "node:test"
import { TOOL } from "@/plugins/embed/protocol"
import { createAgentToolPreview } from "./agent-tool-preview"

test("tool preview: fs write exposes identity and changed fields without content", () => {
  const preview = createAgentToolPreview(TOOL.fsWrite, {
    kind: "note",
    id: "note-1",
    title: "新标题",
    content: [{ text: "private body" }],
  })
  assert.equal(preview.title, "修改笔记")
  assert.equal(preview.risk, "medium")
  assert.equal(preview.mutating, true)
  assert.equal(preview.target?.id, "note-1")
  assert.match(preview.fields[0]?.value ?? "", /标题/)
  assert.match(preview.fields[0]?.value ?? "", /正文/)
  assert.doesNotMatch(JSON.stringify(preview), /private body/)
})

test("tool preview: browser fill always hides the submitted value", () => {
  const preview = createAgentToolPreview(TOOL.browserFill, {
    selector: "#password",
    text: "secret-123",
  })
  assert.equal(preview.risk, "high")
  assert.equal(preview.effect, "external")
  assert.equal(preview.fields[0]?.value, "已隐藏")
  assert.doesNotMatch(JSON.stringify(preview), /secret-123/)
})

test("tool preview: URLs drop credentials, query and fragment", () => {
  const preview = createAgentToolPreview(TOOL.browserNavigate, {
    url: "https://user:pass@example.com/path?token=secret#private",
  })
  assert.equal(preview.target?.label, "https://example.com/path")
  assert.doesNotMatch(JSON.stringify(preview), /pass|token|secret|private/)
})

test("tool preview: unknown external tools disclose field names but not values", () => {
  const preview = createAgentToolPreview("m2_publish", {
    channel: "public",
    authorization: "Bearer secret",
    body: "private body",
  })
  assert.equal(preview.effect, "external")
  assert.equal(preview.risk, "high")
  assert.equal(preview.mutating, true)
  assert.equal(preview.fields[0]?.value, "3 个字段（值已隐藏）")
  assert.doesNotMatch(JSON.stringify(preview), /Bearer secret|private body|public/)
})
