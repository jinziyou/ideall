import { test } from "node:test"
import assert from "node:assert/strict"
import { fileEngineTab } from "./file-tab"
import { tabDescriptor } from "./tab-definitions"
import { tabKey } from "./tab-key"
import { activeTabMatchesRouteDescriptor, activeTabMatchesRouteFile } from "./route-open-guard"

const ref = { fileSystemId: "test.route-guard", fileId: "one" }
const descriptor = fileEngineTab({ ref, name: "one" }, "ideall.preview", {
  navigationPath: "/home/files/one",
})
const active = { ...descriptor, id: tabKey(descriptor) }

test("route open guard: matching URL echo does not reopen the active file tab", () => {
  assert.equal(activeTabMatchesRouteFile(active, { ref, engineId: "ideall.preview" }), true)
  assert.equal(
    activeTabMatchesRouteFile(active, {
      ref,
      engineId: "ideall.preview",
      navigationPath: "/home/files/one",
    }),
    true,
  )
  assert.equal(activeTabMatchesRouteFile(active, { ref, engineId: "ideall.code" }), false)
  assert.equal(
    activeTabMatchesRouteFile(active, {
      ref,
      engineId: "ideall.preview",
      navigationPath: "/alternate/one",
    }),
    false,
  )
})

test("route open guard: legacy descriptors compare after runtime migration", () => {
  const legacy = tabDescriptor("home-bookmarks")
  const migrated = fileEngineTab(
    { ref: { fileSystemId: "ideall.core", fileId: "place:bookmarks" }, name: "书签" },
    "ideall.bookmarks",
    { module: "home", rootId: "home", path: "/home/bookmarks" },
  )
  assert.equal(activeTabMatchesRouteDescriptor({ ...migrated, id: tabKey(migrated) }, legacy), true)
})
