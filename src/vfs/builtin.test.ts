import { test, afterEach } from "node:test"
import assert from "node:assert/strict"
import { clearVfsProvidersForTest, listResources, listVfsProviderSchemes } from "./registry"
import { registerBuiltInVfsProviders } from "./builtin"

afterEach(() => {
  clearVfsProvidersForTest()
})

test("builtin vfs providers: register all schemes idempotently", async () => {
  registerBuiltInVfsProviders()
  registerBuiltInVfsProviders()

  assert.deepEqual(listVfsProviderSchemes().sort(), [
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
