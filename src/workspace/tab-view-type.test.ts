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

test("node resources remain discoverable after migration to file-engine tabs", () => {
  const ref = resourceFileRef({ scheme: "node", kind: "note", id: "note-1" })
  assert.deepEqual(nodeResourceRefForTab(tabFor(ref, "ideall.note")), {
    scheme: "node",
    kind: "note",
    id: "note-1",
  })
  assert.equal(nodeResourceRefForTab(tabFor(panelFileRef("home"))), null)
})
