import assert from "node:assert/strict"
import { test } from "node:test"
import { isNavigationPathAtOrBelow, navigationEntryPath } from "./navigation-tree-path"

test("navigation tree path: derives a canonical descendant path from each directory entry", () => {
  const projectPath = navigationEntryPath("/home/bookmarks", "projects")
  assert.equal(projectPath, "/home/bookmarks/projects")
  assert.equal(navigationEntryPath(projectPath, "ideall"), "/home/bookmarks/projects/ideall")
  assert.equal(navigationEntryPath("//home/./bookmarks", "projects"), "/home/bookmarks/projects")
  assert.equal(navigationEntryPath("/home/bookmarks", undefined), undefined)
  assert.equal(navigationEntryPath(undefined, "projects"), undefined)
})

test("navigation tree path: a parent link is active for itself and its descendants only", () => {
  assert.equal(isNavigationPathAtOrBelow("/home/bookmarks", "/home/bookmarks"), true)
  assert.equal(isNavigationPathAtOrBelow("/home/bookmarks/projects", "/home/bookmarks"), true)
  assert.equal(isNavigationPathAtOrBelow("/home/bookmarks-old", "/home/bookmarks"), false)
  assert.equal(isNavigationPathAtOrBelow("/home/resources", "/home/bookmarks"), false)
  assert.equal(isNavigationPathAtOrBelow(undefined, "/home/bookmarks"), false)
})
