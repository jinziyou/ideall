import assert from "node:assert/strict"
import { test } from "node:test"
import {
  aiTasksPanelFileRef,
  panelFileRef,
  resourceFileRef,
} from "@/filesystem/resource-file-system"
import { fileEngineTab } from "./file-tab"
import { nodeResourceRefForTab } from "./resource-tab"
import { tabViewType } from "./tab-view-type"

function tabFor(ref: ReturnType<typeof panelFileRef>, engineId = "ideall.panel") {
  const descriptor = fileEngineTab({ ref, name: ref.fileId }, engineId)
  return { ...descriptor, id: "test" }
}

test("file-engine panel tabs preserve their display classification", () => {
  assert.equal(tabViewType(tabFor(panelFileRef("home"))), "overview")
  assert.equal(tabViewType(tabFor(panelFileRef("settings"))), "config")
  assert.equal(tabViewType(tabFor(aiTasksPanelFileRef("workspace"))), "config")
  assert.equal(
    tabViewType(
      tabFor(resourceFileRef({ scheme: "node", kind: "file", id: "source" }), "ideall.code"),
    ),
    "content",
  )
})

test("semantic management Displays remain classified as configuration tabs", () => {
  const fixtures = [
    [{ fileSystemId: "app.agent-config", fileId: "config:workspaces" }, "ideall.agent-spaces"],
    [{ fileSystemId: "app.agent-config", fileId: "config:tasks" }, "ideall.agent-tasks"],
    [{ fileSystemId: "app.agent-config", fileId: "config:settings" }, "ideall.agent-settings"],
    [{ fileSystemId: "app.settings", fileId: "root" }, "ideall.settings"],
  ] as const

  for (const [ref, engineId] of fixtures) {
    assert.equal(tabViewType(tabFor(ref, engineId)), "config")
  }
})

test("node resources remain discoverable after migration to file-engine tabs", () => {
  const ref = resourceFileRef({ scheme: "node", kind: "note", id: "note-1" })
  assert.deepEqual(nodeResourceRefForTab(tabFor(ref, "ideall.note")), {
    scheme: "node",
    kind: "note",
    id: "note-1",
  })
  assert.equal(nodeResourceRefForTab(tabFor(panelFileRef("home"))), null)
})
