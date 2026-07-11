import { test, afterEach } from "node:test"
import assert from "node:assert/strict"
import { clearResourceSourcesForTest, listResources, listResourceSourceSchemes } from "./registry"
import { registerBuiltInResourceSources } from "./builtin"

afterEach(() => {
  clearResourceSourcesForTest()
})

test("builtin resource sources: register all schemes idempotently", async () => {
  registerBuiltInResourceSources()
  registerBuiltInResourceSources()

  assert.deepEqual(listResourceSourceSchemes().sort(), [
    "app",
    "browser",
    "community",
    "info",
    "node",
    "tool",
  ])
  assert.deepEqual(
    (await listResources({ scheme: "tool" }, { actor: "ui", permissions: [] })).items.map(
      (item) => item.ref.kind,
    ),
    ["search", "ai", "navigation"],
  )
})
