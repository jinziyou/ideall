import assert from "node:assert/strict"
import { test } from "node:test"

const values = new Map<string, string>()
const localStorageStub: Storage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => void values.set(key, value),
  removeItem: (key) => void values.delete(key),
  clear: () => values.clear(),
  key: (index) => [...values.keys()][index] ?? null,
  get length() {
    return values.size
  },
}

test("agent workspace migration: keeps explicit optional consent but drops unknown permissions", async () => {
  Object.defineProperty(globalThis, "localStorage", {
    value: localStorageStub,
    configurable: true,
  })
  values.set(
    "ideall:agent:workspaces:v1",
    JSON.stringify({
      activeId: "explicit",
      workspaces: [
        {
          id: "explicit",
          name: "Explicit",
          capabilities: {
            permissions: [
              "fs:read",
              "agent.config:read",
              "identity.publish",
              "future.unknown",
              "fs:read",
            ],
          },
        },
        { id: "defaulted", name: "Defaulted" },
      ],
    }),
  )

  const { getWorkspacesState } = await import("./agent-workspace")
  const state = getWorkspacesState()
  assert.deepEqual(state.workspaces[0]?.capabilities.permissions, ["fs:read", "agent.config:read"])
  assert.equal(
    state.workspaces[1]?.capabilities.permissions.includes("agent.config:read"),
    false,
    "missing legacy permissions must use the safe default set",
  )
})
