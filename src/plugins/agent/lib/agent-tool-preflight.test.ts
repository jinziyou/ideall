import assert from "node:assert/strict"
import { test } from "node:test"
import type { IdeallFile } from "@protocol/file-system"
import { TOOL } from "@/plugins/embed/protocol"
import { createAgentToolPreview } from "./agent-tool-preview"
import {
  AgentToolPreflightError,
  prepareLocalAgentToolCall,
  type AgentToolPreflightGateway,
} from "./agent-tool-preflight"

const file: IdeallFile = {
  ref: { fileSystemId: "ideall.core", fileId: "resource:node:note:note-1" },
  kind: "directory",
  name: "真实目标",
  mediaType: "application/vnd.ideall.note+json",
  capabilities: ["read", "write"],
  source: { kind: "local", id: "test" },
  version: "42",
}

test("tool preflight binds the real target version and overrides model input", async () => {
  let calls = 0
  const gateway: AgentToolPreflightGateway = {
    async stat(_ref, ctx) {
      calls += 1
      assert.equal(ctx.actor, "agent")
      assert.equal(ctx.intent, "metadata")
      return file
    },
  }
  const args = {
    kind: "note",
    id: "note-1",
    title: "新标题",
    expectedVersion: "forged-by-model",
  }
  const prepared = await prepareLocalAgentToolCall(
    TOOL.fsWrite,
    args,
    createAgentToolPreview(TOOL.fsWrite, args),
    ["fs:read", "fs.notes:write"],
    gateway,
  )

  assert.equal(calls, 1)
  assert.equal(prepared.args.expectedVersion, "42")
  assert.equal(prepared.preview.target?.label, "真实目标")
  assert.deepEqual(prepared.preview.fields.at(-1), { label: "确认版本", value: "42" })
  assert.equal(args.expectedVersion, "forged-by-model", "preflight must not mutate model args")
})

test("tool preflight fails closed when the target or version is unavailable", async () => {
  const preview = createAgentToolPreview(TOOL.fsDelete, { kind: "note", id: "missing" })
  await assert.rejects(
    () =>
      prepareLocalAgentToolCall(
        TOOL.fsDelete,
        { kind: "note", id: "missing" },
        preview,
        ["fs:read", "fs.notes:write"],
        { stat: async () => null },
      ),
    AgentToolPreflightError,
  )
  await assert.rejects(
    () =>
      prepareLocalAgentToolCall(
        TOOL.fsDelete,
        { kind: "note", id: "missing" },
        preview,
        ["fs:read", "fs.notes:write"],
        { stat: async () => ({ ...file, version: undefined }) },
      ),
    /version|\u7248本/,
  )
})

test("tool preflight leaves non-versioned tools untouched without metadata IO", async () => {
  const args = { query: "example" }
  const preview = createAgentToolPreview(TOOL.webSearch, args)
  const prepared = await prepareLocalAgentToolCall(TOOL.webSearch, args, preview, ["web:search"], {
    stat: async () => assert.fail("read-only tools must not preflight Node metadata"),
  })
  assert.equal(prepared.args, args)
  assert.equal(prepared.preview, preview)
})
