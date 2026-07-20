import { afterEach, test } from "node:test"
import assert from "node:assert/strict"
import { clearFileSystemsForTest, getFileSystem, readFileDirectory } from "./registry"
import { ideallRootFileSystem, registerBuiltInFileSystems } from "./builtin"
import { NAVIGATION_FILE_SYSTEM_ID, navigationDirectoryRef } from "./navigation-file-system"
import { resolveIdeallPath } from "./path"
import { corePlaceRef } from "./resource-file-system"

afterEach(() => clearFileSystemsForTest())

test("builtin filesystem: root exposes the five navigation sections", async () => {
  registerBuiltInFileSystems()
  registerBuiltInFileSystems()
  const root = getFileSystem("ideall.root")
  assert.ok(root)
  assert.ok(getFileSystem(NAVIGATION_FILE_SYSTEM_ID))
  const page = await readFileDirectory(ideallRootFileSystem.descriptor.root, {
    actor: "ui",
    permissions: [],
    intent: "directory",
  })
  assert.deepEqual(
    page.entries.map((entry) => [
      entry.entryId,
      entry.pathName,
      entry.name,
      entry.target.fileId,
      entry.properties?.navigationSection,
    ]),
    [
      ["home", "home", "我的", "/home", "home"],
      ["activity", "activity", "活动", "/activity", "activity"],
      ["browse", "browse", "浏览", "/browse", "browse"],
      ["apps", "apps", "应用", "/apps", "apps"],
      ["settings", "settings", "设置", "/settings", "settings"],
    ],
  )
  assert.ok(page.entries.every((entry) => entry.parent.fileSystemId === "ideall.root"))
  assert.ok(page.entries.every((entry) => entry.target.fileSystemId === NAVIGATION_FILE_SYSTEM_ID))

  const home = await readFileDirectory(navigationDirectoryRef("home"), {
    actor: "ui",
    permissions: [],
    intent: "directory",
  })
  assert.deepEqual(
    home.entries.map((entry) => [entry.pathName, entry.properties?.preferredEngine]),
    [
      ["inbox", "ideall.panel"],
      ["following", "ideall.subscriptions"],
      ["bookmarks", "ideall.bookmarks"],
      ["resources", "ideall.resources"],
      ["files", "ideall.directory"],
    ],
  )

  const resolved = await resolveIdeallPath("/home/bookmarks", {
    actor: "ui",
    permissions: [],
  })
  assert.deepEqual(resolved?.ref, corePlaceRef("bookmarks"))
  assert.deepEqual(
    resolved?.entries.map((entry) => entry.pathName),
    ["home", "bookmarks"],
  )
})
