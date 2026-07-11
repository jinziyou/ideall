import { test } from "node:test"
import assert from "node:assert/strict"
import {
  CONNECTED_STATIC_RESOURCES,
  canSaveConnectedResourceToMine,
  connectedResourceCapabilities,
  connectedResourceTitle,
  routeForConnectedResource,
} from "./connected-resource"

test("connected resource manifest: defines static resources per connected scheme", () => {
  assert.deepEqual(
    CONNECTED_STATIC_RESOURCES.tool.map((resource) => resource.ref),
    [
      { scheme: "tool", kind: "search", id: "default" },
      { scheme: "tool", kind: "ai", id: "default" },
      { scheme: "tool", kind: "navigation", id: "default" },
    ],
  )
  assert.equal(CONNECTED_STATIC_RESOURCES.browser[0]?.title, "浏览器")
})

test("connected resource manifest: resolves route title and save capabilities", () => {
  const entity = { scheme: "info", kind: "entity", id: "ORG:示例" } as const
  const invalidEntity = { scheme: "info", kind: "entity", id: "示例" } as const

  assert.equal(routeForConnectedResource(entity), "/info/entity?label=ORG&name=%E7%A4%BA%E4%BE%8B")
  assert.equal(connectedResourceTitle(entity), "实体 · 示例")
  assert.equal(canSaveConnectedResourceToMine(entity), true)
  assert.equal(canSaveConnectedResourceToMine(invalidEntity), false)
  assert.deepEqual(connectedResourceCapabilities({ scheme: "info", kind: "home", id: "default" }), [
    "open",
    "preview",
    "navigate",
  ])
  assert.ok(connectedResourceCapabilities(entity).includes("save-to-mine"))
})
