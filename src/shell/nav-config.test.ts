import assert from "node:assert/strict"
import test from "node:test"
import { directorySurface } from "@/workspace/directory-surfaces"
import {
  BOOKMARKS_TARGET,
  BROWSER_TARGET,
  CODE_TARGET,
  COMMUNITY_TARGET,
  FILES_TARGET,
  FOLLOWING_TARGET,
  HOME_SUBPAGES,
  HOME_TARGET,
  INBOX_TARGET,
  INSTALLED_APPS_TARGET,
  NEWS_TARGET,
  OVERVIEW_TARGET,
  RESOURCES_TARGET,
  SEARCH_TARGET,
  SPOKES,
  TRASH_TARGET,
} from "./nav-config"

test("shell navigation targets use canonical FileSystem paths", () => {
  assert.deepEqual(
    [
      HOME_TARGET,
      INBOX_TARGET,
      FILES_TARGET,
      FOLLOWING_TARGET,
      RESOURCES_TARGET,
      BOOKMARKS_TARGET,
    ].map((target) => target.path),
    [
      "/home",
      "/home/inbox",
      "/home/files",
      "/home/following",
      "/home/resources",
      "/home/bookmarks",
    ],
  )
  assert.deepEqual(
    [NEWS_TARGET, COMMUNITY_TARGET, BROWSER_TARGET, SEARCH_TARGET].map((target) => target.path),
    ["/browse/news", "/browse/community", "/browse/browser", "/apps/search"],
  )
})

test("management entry targets share the directory-surface canonical paths", () => {
  assert.equal(FOLLOWING_TARGET.path, directorySurface("subscriptions").navigationPath)
  assert.equal(BOOKMARKS_TARGET.path, directorySurface("bookmarks").navigationPath)
  assert.equal(RESOURCES_TARGET.path, directorySurface("resources").navigationPath)
  assert.equal(TRASH_TARGET.path, directorySurface("trash").navigationPath)
  assert.equal(INSTALLED_APPS_TARGET.path, directorySurface("installed-apps").navigationPath)
})

test("shell navigation data no longer emits legacy href identities", () => {
  const legacyPaths = new Set(["/home/subscriptions", "/trash", "/apps"])
  for (const item of [...HOME_SUBPAGES, ...SPOKES]) {
    assert.equal("href" in item, false, item.id)
    assert.equal(legacyPaths.has(item.shortcut ?? ""), false, item.id)
    if (item.target.type === "path") {
      assert.equal(legacyPaths.has(item.target.path), false, item.id)
    }
  }
  assert.equal(HOME_SUBPAGES[0]?.target, OVERVIEW_TARGET)
  assert.ok(HOME_SUBPAGES.slice(1).every((item) => item.target.type === "path"))
  assert.deepEqual(OVERVIEW_TARGET.ref, {
    fileSystemId: "ideall.core",
    fileId: "panel:home",
  })
  assert.equal(CODE_TARGET.type, "file")
})
