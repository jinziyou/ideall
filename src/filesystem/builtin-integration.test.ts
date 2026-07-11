import { afterEach, test } from "node:test"
import assert from "node:assert/strict"
import { clearFileSystemsForTest, getFileSystem, readFileDirectory } from "./registry"
import { ideallRootFileSystem, registerBuiltInFileSystems } from "./builtin"

afterEach(() => clearFileSystemsForTest())

test("builtin filesystem: hidden root exposes core second-level subtrees", async () => {
  registerBuiltInFileSystems()
  registerBuiltInFileSystems()
  const root = getFileSystem("ideall.root")
  assert.ok(root)
  const page = await readFileDirectory(ideallRootFileSystem.descriptor.root, {
    actor: "ui",
    permissions: [],
    intent: "directory",
  })
  assert.deepEqual(
    page.entries.slice(0, 5).map((entry) => entry.entryId),
    ["home", "subscriptions", "bookmarks", "files", "notes"],
  )
  assert.ok(page.entries.every((entry) => entry.parent.fileSystemId === "ideall.root"))
  assert.equal(
    page.entries.find((entry) => entry.entryId === "workspace")?.properties?.navigationHidden,
    true,
  )
  for (const id of ["bookmarks", "files", "notes", "system"] as const) {
    assert.equal(
      page.entries.find((entry) => entry.entryId === id)?.properties?.navigationHidden,
      true,
      `${id} should stay off the activity bar`,
    )
  }
})
