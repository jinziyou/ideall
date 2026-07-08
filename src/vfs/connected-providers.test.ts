import { test } from "node:test"
import assert from "node:assert/strict"
import { resourceKey } from "@protocol/resource"
import { infoVfsProvider, routeForConnectedResource, toolVfsProvider } from "./connected-providers"
import { VfsError, type VfsAccessContext } from "./types"

const ctx: VfsAccessContext = { actor: "ui", permissions: [] }

async function rejectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof VfsError)
    assert.equal(error.code, code)
    return true
  })
}

test("connected providers: route resources list/get/invoke without wire DTOs", async () => {
  const tools = await toolVfsProvider.list({ scheme: "tool", text: "AI" }, ctx)
  assert.deepEqual(
    tools.items.map((item) => item.ref),
    [{ scheme: "tool", kind: "ai", id: "default" }],
  )

  const entityRef = { scheme: "info", kind: "entity", id: "ORG:示例" } as const
  const entity = await infoVfsProvider.get(entityRef, ctx)
  assert.equal(entity?.meta.route, "/info/entity?label=ORG&name=%E7%A4%BA%E4%BE%8B")
  assert.equal(resourceKey(entityRef), "info:entity:ORG%3A%E7%A4%BA%E4%BE%8B")

  assert.deepEqual(await infoVfsProvider.invoke(entityRef, "navigate", null, ctx), {
    ref: entityRef,
    route: "/info/entity?label=ORG&name=%E7%A4%BA%E4%BE%8B",
  })
})

test("connected providers: reject invalid kinds and expose shared route mapping", async () => {
  await rejectCode(toolVfsProvider.list({ scheme: "tool", kind: "entity" }, ctx), "unsupported")
  assert.equal(
    routeForConnectedResource({ scheme: "community", kind: "peer", id: "42" }),
    "/community?openPeer=42",
  )
})
