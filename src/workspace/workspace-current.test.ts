import assert from "node:assert/strict"
import test from "node:test"

import { fileEngineTab, parseFileEngineTabParams } from "./file-tab"
import { migrateWorkspaceTab, migrateWorkspaceTabs } from "./workspace-compat"

test("workspace current baseline: canonical File+Engine tabs retain identity", () => {
  const descriptor = fileEngineTab(
    { ref: { fileSystemId: "ideall.core", fileId: "place:notes" }, name: "笔记" },
    "ideall.directory",
    { rootId: "home", navigationPath: "/home/notes" },
  )
  const migrated = migrateWorkspaceTab({ ...descriptor, id: "stale-id" })
  assert.ok(migrated)
  assert.notEqual(migrated.id, "stale-id")
  assert.deepEqual(parseFileEngineTabParams(migrated.params), {
    ref: { fileSystemId: "ideall.core", fileId: "place:notes" },
    engineId: "ideall.directory",
  })
})

test("workspace current baseline: malformed tabs are discarded and canonical duplicates collapse", () => {
  const descriptor = fileEngineTab(
    { ref: { fileSystemId: "ideall.core", fileId: "place:files" }, name: "资源" },
    "ideall.resources",
    { rootId: "home", navigationPath: "/home/resources" },
  )
  const result = migrateWorkspaceTabs([
    { ...descriptor, id: "first" },
    { ...descriptor, id: "second" },
    { ...descriptor, id: "invalid", params: {} },
  ])
  assert.equal(result.tabs.length, 1)
  assert.equal(result.idMap.get("first"), result.tabs[0]?.id)
  assert.equal(result.idMap.get("second"), result.tabs[0]?.id)
  assert.equal(result.idMap.has("invalid"), false)
})
