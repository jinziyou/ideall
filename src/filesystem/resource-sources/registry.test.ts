import { test, afterEach } from "node:test"
import assert from "node:assert/strict"
import type { ResourceRef } from "@protocol/resource"
import {
  clearResourceSourcesForTest,
  getResource,
  getResources,
  getResourceSource,
  invokeResourceAction,
  listResources,
  listResourceSourceSchemes,
  registerResourceSource,
  resourceActions,
  watchResources,
} from "./registry"
import {
  ResourceSourceError,
  type ResourceSourceAccessContext,
  type ResourceSourceProvider,
} from "./types"

const ctx: ResourceSourceAccessContext = { actor: "ui", permissions: [] }
const ref: ResourceRef = { scheme: "tool", kind: "search", id: "default" }

afterEach(() => {
  clearResourceSourcesForTest()
})

function provider(): ResourceSourceProvider {
  return {
    scheme: "tool",
    async list(query, access) {
      assert.equal(query.scheme, "tool")
      assert.equal(access, ctx)
      return {
        items: [{ ref, title: "Search", capabilities: ["open"] }],
        nextCursor: "next",
      }
    },
    async get(nextRef, access) {
      assert.equal(nextRef, ref)
      assert.equal(access, ctx)
      return { meta: { ref, title: "Search", capabilities: ["open"] } }
    },
    async actions(nextRef, access) {
      assert.equal(nextRef, ref)
      assert.equal(access, ctx)
      return [{ id: "open", label: "打开" }]
    },
    async invoke(nextRef, action, input, access) {
      assert.equal(nextRef, ref)
      assert.equal(action, "open")
      assert.deepEqual(input, { via: "test" })
      assert.equal(access, ctx)
      return "ok"
    },
    watch(query, access, notify) {
      assert.equal(query.scheme, "tool")
      assert.equal(access, ctx)
      notify()
      return { dispose: () => undefined }
    },
  }
}

test("resource source registry: 注册、分派与注销 provider", async () => {
  let notified = false
  const unregister = registerResourceSource(provider())

  assert.equal(getResourceSource("tool")?.scheme, "tool")
  assert.deepEqual(listResourceSourceSchemes(), ["tool"])
  assert.equal((await listResources({ scheme: "tool" }, ctx)).nextCursor, "next")
  assert.equal((await getResource(ref, ctx))?.meta.title, "Search")
  assert.deepEqual(await resourceActions(ref, ctx), [{ id: "open", label: "打开" }])
  assert.equal(await invokeResourceAction(ref, "open", { via: "test" }, ctx), "ok")
  assert.ok(watchResources({ scheme: "tool" }, ctx, () => (notified = true)))
  assert.equal(notified, true)

  unregister()
  assert.equal(getResourceSource("tool"), null)
})

test("resource source registry: 重复注册与未知 scheme 报错", async () => {
  registerResourceSource(provider())

  assert.throws(
    () => registerResourceSource(provider()),
    (error) => {
      assert.ok(error instanceof ResourceSourceError)
      assert.equal(error.code, "unsupported")
      return true
    },
  )

  await assert.rejects(() => getResource({ scheme: "node", kind: "note", id: "n1" }, ctx), {
    name: "ResourceSourceError",
    code: "unsupported",
  })
})

test("resource source registry: getMany fallback preserves order with bounded remote pressure", async () => {
  let active = 0
  let maxActive = 0
  const remote: ResourceSourceProvider = {
    scheme: "info",
    async list() {
      return { items: [] }
    },
    async get(nextRef) {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 2))
      try {
        if (nextRef.id === "missing") throw new ResourceSourceError("not-found", "missing")
        return { meta: { ref: nextRef, title: nextRef.id, capabilities: ["open"] } }
      } finally {
        active -= 1
      }
    },
    async actions() {
      return []
    },
    async invoke() {
      throw new ResourceSourceError("unsupported", "unsupported")
    },
  }
  registerResourceSource(remote)
  const refs: ResourceRef[] = ["a", "b", "missing", "c", "d"].map((id) => ({
    scheme: "info",
    kind: "home",
    id,
  }))

  const values = await getResources(refs, ctx, 2)
  assert.deepEqual(
    values.map((value) => value?.meta.ref.id ?? null),
    ["a", "b", null, "c", "d"],
  )
  assert.equal(maxActive, 2)

  remote.get = async () => {
    throw new ResourceSourceError("permission-denied", "private")
  }
  await assert.rejects(
    () => getResources(refs, ctx, 2),
    (error) => error instanceof ResourceSourceError && error.code === "permission-denied",
  )
})

test("resource source registry: native getMany rejects sparse result arrays", async () => {
  const native = provider()
  native.getMany = async () => new Array(1) as Array<null>
  registerResourceSource(native)

  await assert.rejects(
    () => getResources([ref], ctx),
    (error) => error instanceof ResourceSourceError && error.code === "unsupported",
  )
})
