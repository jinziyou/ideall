import { test } from "node:test"
import assert from "node:assert/strict"
import {
  resolveNodeResourceViewer,
  resolveResourceEngine,
  resourceLayout,
} from "./resource-engines"

test("resource engines: resolve node layout/viewer from ResourceRef", () => {
  const note = { scheme: "node", kind: "note", id: "n1" } as const
  assert.equal(resourceLayout(note), "fill")
  assert.equal(resolveResourceEngine(note)?.scheme, "node")
  assert.ok(resolveNodeResourceViewer(note))

  const folder = { scheme: "node", kind: "folder", id: "f1" } as const
  assert.equal(resourceLayout(folder), "padded")
  assert.equal(resolveNodeResourceViewer(folder), null)
})

test("resource engines: resolve connected route resource layout/icon", () => {
  const tool = { scheme: "tool", kind: "search", id: "default" } as const
  assert.equal(resourceLayout(tool), "padded")
  assert.equal(resolveResourceEngine(tool)?.kind, "search")

  const info = { scheme: "info", kind: "entity", id: "ORG:示例" } as const
  assert.equal(resourceLayout(info), "fill")
  assert.ok(resolveResourceEngine(info)?.icon)
})
