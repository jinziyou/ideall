import { test } from "node:test"
import assert from "node:assert/strict"
import { HOME_PLACES, homePlaceById, homePlaceForNodeKind } from "./home-places"

test("home places: 锁定「我的」区段顺序与特殊 descriptor", () => {
  assert.deepEqual(
    HOME_PLACES.map((place) => place.id),
    ["subscriptions", "bookmarks", "resources", "notes", "workspace"],
  )

  const subscriptions = homePlaceById("subscriptions")
  assert.equal(subscriptions?.descriptor?.kind, "subscriptions")
  assert.equal(subscriptions?.descriptor?.module, "home")
  assert.equal(subscriptions?.descriptor?.path, undefined)
  assert.deepEqual(subscriptions?.descriptor?.params, { in: "home" })

  assert.equal(homePlaceById("workspace")?.descriptor, undefined)
  assert.deepEqual(
    homePlaceById("workspace")?.staticChildren?.map((child) => ({
      id: child.id,
      childKinds: child.childKinds,
    })),
    [{ id: "threads", childKinds: ["thread"] }],
  )
})

test("home places: NodeKind 到所属区段单源映射", () => {
  assert.equal(homePlaceForNodeKind("feed")?.id, "subscriptions")
  assert.equal(homePlaceForNodeKind("folder")?.id, "bookmarks")
  assert.equal(homePlaceForNodeKind("bookmark")?.id, "bookmarks")
  assert.equal(homePlaceForNodeKind("file")?.id, "resources")
  assert.equal(homePlaceForNodeKind("note")?.id, "notes")
  assert.equal(homePlaceForNodeKind("thread")?.id, "workspace")
})
