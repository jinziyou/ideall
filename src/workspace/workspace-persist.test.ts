import { test } from "node:test"
import assert from "node:assert/strict"
import type { WorkspacePersistSnapshot } from "./workspace-persist"
import {
  WORKSPACE_PERSIST_VERSION,
  WORKSPACE_STORAGE_KEY,
  scheduleWorkspaceSnapshotPersistence,
} from "./workspace-persist"

function snapshot(activeRootId: string): WorkspacePersistSnapshot {
  return {
    tabs: [],
    activeId: null,
    transientId: null,
    activeModule: "home",
    activeRootId,
    workspaceKind: "files",
    developmentTool: "git",
    sidebarCollapsed: false,
    rightPanelOpen: false,
  }
}

test("workspace persistence: click bursts are deferred and coalesced to the newest snapshot", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window")
  const writes: Array<{ area: string; key: string; value: string }> = []
  let idleCallback: (() => void) | null = null
  const storage = (area: string) => ({
    setItem(key: string, value: string) {
      writes.push({ area, key, value })
    },
  })
  const fakeWindow = {
    sessionStorage: storage("session"),
    localStorage: storage("local"),
    requestIdleCallback(callback: () => void) {
      idleCallback = callback
      return 1
    },
    setTimeout(callback: () => void) {
      callback()
      return 1
    },
    addEventListener() {},
    document: {
      visibilityState: "visible",
      addEventListener() {},
    },
  }
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: fakeWindow,
  })

  try {
    scheduleWorkspaceSnapshotPersistence(snapshot("home"), true)
    scheduleWorkspaceSnapshotPersistence(snapshot("activity"), true)
    assert.equal(writes.length, 0)
    assert.ok(idleCallback)
    ;(idleCallback as () => void)()

    assert.equal(writes.length, 2)
    assert.deepEqual(
      writes.map(({ area, key }) => [area, key]),
      [
        ["session", WORKSPACE_STORAGE_KEY],
        ["local", WORKSPACE_STORAGE_KEY],
      ],
    )
    assert.equal(JSON.parse(writes[0]!.value).activeRootId, "activity")
    assert.equal(JSON.parse(writes[0]!.value).version, WORKSPACE_PERSIST_VERSION)
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow)
    else delete (globalThis as { window?: unknown }).window
  }
})
