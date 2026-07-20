import assert from "node:assert/strict"
import { test } from "node:test"
import { genericFileActionSupport, visibleGenericFileActions } from "./generic-file-action-menu"

test("generic file actions: explicitly parameterless actions can run", () => {
  assert.deepEqual(genericFileActionSupport({ id: "open", label: "启动", kind: "invoke" }), {
    canInvoke: true,
    requiresInput: false,
    requiresConfirmation: false,
  })
})

test("generic file actions: display-only open is hidden instead of invoking the provider", () => {
  const open = { id: "open", label: "打开", kind: "display" as const }
  assert.deepEqual(visibleGenericFileActions([open]), [])
  assert.deepEqual(genericFileActionSupport(open), {
    canInvoke: false,
    requiresInput: false,
    requiresConfirmation: false,
    reason: "由文件视图处理",
  })
})

test("generic file actions: destructive parameterless actions require confirmation", () => {
  assert.deepEqual(
    genericFileActionSupport({
      id: "open",
      label: "启动",
      risk: "destructive",
      kind: "invoke",
    }),
    {
      canInvoke: true,
      requiresInput: false,
      requiresConfirmation: true,
    },
  )
})

test("generic file actions: schemas open a form and specialized actions stay disabled", () => {
  assert.deepEqual(
    genericFileActionSupport({
      id: "rename",
      label: "重命名",
      kind: "invoke",
      input: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
    }),
    {
      canInvoke: true,
      requiresInput: true,
      requiresConfirmation: false,
    },
  )
  assert.deepEqual(
    genericFileActionSupport({
      id: "oauth",
      label: "授权",
      kind: "specialized",
      reason: "需要 OAuth",
    }),
    {
      canInvoke: false,
      requiresInput: false,
      requiresConfirmation: false,
      reason: "需要 OAuth",
    },
  )
  assert.deepEqual(genericFileActionSupport({ id: "delete", label: "删除", kind: "specialized" }), {
    canInvoke: false,
    requiresInput: false,
    requiresConfirmation: false,
    reason: "需在专用界面操作",
  })
})
