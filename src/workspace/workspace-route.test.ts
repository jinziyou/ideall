import assert from "node:assert/strict"
import { test } from "node:test"
import { workspaceCommandForPath } from "./workspace-route"

test("workspace command routes select the matching dock without opening a tool tab", () => {
  assert.deepEqual(workspaceCommandForPath("/audio"), { workspace: "audio" })
  assert.deepEqual(workspaceCommandForPath("/git"), {
    workspace: "development",
    developmentTool: "git",
  })
  assert.deepEqual(workspaceCommandForPath("/database"), {
    workspace: "development",
    developmentTool: "database",
  })
  assert.deepEqual(workspaceCommandForPath("/shell"), {
    workspace: "development",
    developmentTool: "shell",
  })
  assert.equal(workspaceCommandForPath("/code"), null)
  assert.equal(workspaceCommandForPath("/audio/legacy"), null)
})
