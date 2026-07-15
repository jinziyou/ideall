import assert from "node:assert/strict"
import { test } from "node:test"
import { sha256SemanticVersion } from "./semantic-version"

test("sha256SemanticVersion: binds namespace and exact deterministic snapshot", async () => {
  const first = await sha256SemanticVersion("collection-v1", "same snapshot")
  const repeated = await sha256SemanticVersion("collection-v1", "same snapshot")
  const changed = await sha256SemanticVersion("collection-v1", "changed snapshot")
  const upgraded = await sha256SemanticVersion("collection-v2", "same snapshot")

  assert.match(first, /^collection-v1:[0-9a-f]{64}$/)
  assert.equal(repeated, first)
  assert.notEqual(changed, first)
  assert.notEqual(upgraded, first)
})
