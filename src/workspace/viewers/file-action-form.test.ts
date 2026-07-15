import assert from "node:assert/strict"
import { test } from "node:test"
import type { FileAction } from "@/filesystem/types"
import {
  capturePendingFileAction,
  fileActionInvokeOptions,
  fileActionRisk,
  initialFileActionDraft,
  isCommittedFileActionVersionSuperseded,
  isPendingFileActionCurrent,
  parseFileActionInput,
  pendingFileActionInvokeOptions,
} from "./file-action-form"

test("file action form: coerces and validates a declared object schema", () => {
  const schema = {
    type: "object" as const,
    required: ["name", "count"],
    properties: {
      name: { type: "string" as const, title: "名称", minLength: 2 },
      count: { type: "integer" as const, title: "数量", minimum: 1 },
      enabled: { type: "boolean" as const, default: true },
      tags: { type: "array" as const, items: { type: "string" as const } },
    },
  }

  assert.deepEqual(initialFileActionDraft(schema), {
    name: "",
    count: "",
    enabled: true,
    tags: "",
  })
  assert.deepEqual(
    parseFileActionInput(schema, {
      name: "demo",
      count: "2",
      enabled: false,
      tags: '["a","b"]',
    }),
    {
      ok: true,
      value: { name: "demo", count: 2, enabled: false, tags: ["a", "b"] },
    },
  )
  assert.deepEqual(parseFileActionInput(schema, { name: "x", count: "0" }), {
    ok: false,
    error: "名称至少需要 2 个字符",
  })
})

test("file action form: destructive compatibility maps to risk", () => {
  const legacy = {
    id: "delete",
    label: "删除",
    kind: "invoke",
    destructive: true,
  } satisfies FileAction
  assert.equal(fileActionRisk(legacy), "destructive")
  assert.equal(fileActionRisk({ ...legacy, risk: "caution" }), "caution")
})

test("file action form: pending target includes ref and version", () => {
  const action = { id: "delete", label: "删除", kind: "invoke" } satisfies FileAction
  const first = {
    ref: { fileSystemId: "app.test", fileId: "a" },
    version: "1",
  }
  const pending = capturePendingFileAction(action, first)
  assert.deepEqual(pendingFileActionInvokeOptions(pending), { expectedVersion: "1" })
  assert.deepEqual(fileActionInvokeOptions("2"), { expectedVersion: "2" })
  assert.deepEqual(fileActionInvokeOptions(undefined), { expectedVersion: null })
  assert.equal(isCommittedFileActionVersionSuperseded("3", "2", "1"), true)
  assert.equal(isCommittedFileActionVersionSuperseded("2", "2", "1"), false)
  assert.equal(
    isCommittedFileActionVersionSuperseded("opaque-next", "opaque-commit", "opaque-base"),
    true,
  )
  assert.equal(
    isCommittedFileActionVersionSuperseded("opaque-base", "opaque-commit", "opaque-base"),
    false,
  )
  assert.deepEqual(
    pendingFileActionInvokeOptions({
      ...pending,
      version: undefined,
    }),
    { expectedVersion: null },
  )
  assert.equal(isPendingFileActionCurrent(pending, first), true)
  assert.equal(
    isPendingFileActionCurrent(pending, {
      ref: { fileSystemId: "app.test", fileId: "b" },
      version: "1",
    }),
    false,
  )
  assert.equal(isPendingFileActionCurrent(pending, { ...first, version: "2" }), false)
})

test("file action form: recursively parses object properties", () => {
  const schema = {
    type: "object" as const,
    properties: {
      values: {
        type: "object" as const,
        properties: {
          title: { type: "string" as const },
          done: { type: "boolean" as const },
        },
        required: ["title"],
      },
    },
    required: ["values"],
  }
  assert.deepEqual(parseFileActionInput(schema, { values: { title: "ship", done: true } }), {
    ok: true,
    value: { values: { title: "ship", done: true } },
  })
})
