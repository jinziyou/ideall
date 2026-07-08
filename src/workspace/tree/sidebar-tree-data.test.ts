import { test } from "node:test"
import assert from "node:assert/strict"
import {
  communityTreeRoots,
  infoTreeRoots,
  staticTreeRoots,
  subscriptionsTreeRoots,
} from "./sidebar-tree-data"

test("sidebar tree data: static panel rows expose OpenTarget", () => {
  const homeRoots = staticTreeRoots("home")
  const notes = homeRoots.find((node) => node.id === "section:notes")
  assert.equal(notes?.target?.type, "tab")
  if (notes?.target?.type === "tab") assert.equal(notes.target.descriptor.kind, "home-notes")
  assert.equal("descriptor" in (notes ?? {}), false)
  assert.equal("nodeRef" in (notes ?? {}), false)

  const subscriptions = subscriptionsTreeRoots()[0]
  assert.equal(subscriptions.target?.type, "tab")
  if (subscriptions.target?.type === "tab") {
    assert.equal(subscriptions.target.descriptor.kind, "subscriptions")
  }
})

test("sidebar tree data: connected sections load children through ResourceQuery", () => {
  assert.deepEqual(infoTreeRoots()[0]?.childResourceQuery, { scheme: "info", kind: "entity" })
  assert.deepEqual(communityTreeRoots()[0]?.childResourceQuery, {
    scheme: "community",
    kind: "peer",
  })
})
