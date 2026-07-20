import assert from "node:assert/strict"
import { test } from "node:test"
import { AGENT_WORKSPACES_FILE_REF } from "@/filesystem/builtin-app-roots"
import { AGENT_WORKSPACE_ACTIVATE_ACTION } from "@/plugins/agent/agent-management-file-contract"
import { activateAgentWorkspaceBeforeOpen } from "./agent-workspace-navigation"

test("agent workspace navigation: commits activation through FileSystem before opening", async () => {
  const events: string[] = []
  let release = () => {}
  const activation = new Promise<void>((resolve) => {
    release = resolve
  })
  const pending = activateAgentWorkspaceBeforeOpen(
    "ws-2",
    () => events.push("open"),
    async (ref, action, input, ctx) => {
      assert.deepEqual(ref, AGENT_WORKSPACES_FILE_REF)
      assert.equal(action, AGENT_WORKSPACE_ACTIVATE_ACTION)
      assert.deepEqual(input, { workspaceId: "ws-2" })
      assert.deepEqual(ctx, { actor: "ui", permissions: [], intent: "action" })
      events.push("activate")
      await activation
      events.push("activated")
    },
  )

  await Promise.resolve()
  assert.deepEqual(events, ["activate"])
  release()
  await pending
  assert.deepEqual(events, ["activate", "activated", "open"])
})

test("agent workspace navigation: action failure preserves explicit navigation fallback", async () => {
  const events: string[] = []
  await activateAgentWorkspaceBeforeOpen(
    "missing",
    () => events.push("open"),
    async () => {
      events.push("activate")
      throw new Error("provider unavailable")
    },
  )
  assert.deepEqual(events, ["activate", "open"])
})
