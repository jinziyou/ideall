import { afterEach, test } from "node:test"
import assert from "node:assert/strict"
import { clearFileSystemsForTest, getFileSystem, readFileDirectory } from "./registry"
import { ideallRootFileSystem, registerBuiltInFileSystems } from "./builtin"

afterEach(() => clearFileSystemsForTest())

test("builtin filesystem: root exposes the five navigation sections", async () => {
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
    page.entries.map((entry) => [entry.entryId, entry.name, entry.properties?.navigationSection]),
    [
      ["home", "我的", "home"],
      ["activity", "活动", "activity"],
      ["browse", "浏览", "browse"],
      ["apps", "应用", "apps"],
      ["settings", "设置", "settings"],
    ],
  )
  assert.ok(page.entries.every((entry) => entry.parent.fileSystemId === "ideall.root"))
})
