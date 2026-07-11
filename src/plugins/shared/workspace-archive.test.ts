import { test } from "node:test"
import assert from "node:assert/strict"
import type { Node } from "@protocol/node"
import { createPluginDataPackage, createWorkspaceBackupPackage } from "@/plugins/shared/plugin-data"
import {
  createWorkspaceArchivePackage,
  isWorkspaceArchiveRaw,
  parseWorkspaceArchivePackage,
  previewWorkspaceArchiveImport,
  stringifyWorkspaceArchivePackage,
} from "./workspace-archive"

const noteNode: Node = {
  id: "n1",
  kind: "note",
  title: "Archive Note",
  parentId: null,
  sortKey: "a0",
  tags: ["archive"],
  createdAt: 1,
  updatedAt: 2,
  content: [{ type: "p", children: [{ text: "body" }] }],
}

const gitPackage = createPluginDataPackage(
  {
    pluginId: "git",
    pluginLabel: "Git",
    dataKind: "ideall.git.repos",
    dataVersion: 1,
  },
  { repos: ["/tmp/ideall"] },
  "2026-01-01T00:00:00.000Z",
)

test("workspace archive: 固定格式并可预检完整工作区归档", async () => {
  const pack = createWorkspaceArchivePackage(
    {
      core: {
        nodes: [noteNode],
        blobs: [{ key: "f1", mime: "text/plain", size: 3, dataBase64: "YWJj" }],
        trashSnapshots: [{ id: "n1", node: noteNode, capturedAt: 3 }],
        workspace: {
          tabs: [
            {
              id: "code",
              kind: "code",
              module: "code",
              title: "Code",
              path: "/code",
            },
          ],
          activeId: "code",
          transientId: null,
          activeModule: "code",
          mode: "local",
          workspaceKind: "development",
          developmentTool: "shell",
          sidebarCollapsed: false,
          rightPanelOpen: false,
        },
      },
      plugins: createWorkspaceBackupPackage([gitPackage], "2026-01-01T00:00:00.000Z"),
    },
    "2026-01-01T00:00:00.000Z",
  )
  const raw = stringifyWorkspaceArchivePackage(pack)
  const parsed = parseWorkspaceArchivePackage(raw)

  assert.equal(parsed.kind, "ideall.workspace-archive")
  assert.equal(isWorkspaceArchiveRaw(raw), true)
  assert.equal(parsed.core.nodes.length, 1)
  assert.equal(parsed.core.blobs[0].dataBase64, "YWJj")
  assert.equal(parsed.core.trashSnapshots[0].id, "n1")
  assert.equal(parsed.core.workspace?.tabs.length, 1)
  assert.equal(parsed.core.workspace?.workspaceKind, "development")
  assert.equal(parsed.core.workspace?.developmentTool, "shell")
  assert.equal(parsed.plugins.plugins[0].plugin.id, "git")

  const legacy = JSON.parse(raw) as {
    core: { workspace: Record<string, unknown> }
  }
  delete legacy.core.workspace.workspaceKind
  delete legacy.core.workspace.developmentTool
  const parsedLegacy = parseWorkspaceArchivePackage(JSON.stringify(legacy))
  assert.equal(parsedLegacy.core.workspace?.workspaceKind, "files")
  assert.equal(parsedLegacy.core.workspace?.developmentTool, "git")

  const preview = await previewWorkspaceArchiveImport(raw, "workspace.json")
  assert.equal(preview.ok, true)
  assert.equal(preview.target?.pluginLabel, "完整工作区")
  assert.equal(preview.archive?.nodeCount, 1)
  assert.equal(preview.archive?.blobCount, 1)
  assert.equal(preview.archive?.trashSnapshotCount, 1)
  assert.equal(preview.archive?.pluginCount, 1)
  assert.equal(preview.archive?.tabCount, 1)
})

test("workspace archive: 拒绝非归档格式", () => {
  assert.equal(isWorkspaceArchiveRaw('{"kind":"ideall.workspace-backup"}'), false)
  assert.throws(
    () => parseWorkspaceArchivePackage('{"kind":"ideall.workspace-archive","version":2}'),
    /不支持/,
  )
})

test("workspace archive: 拒绝畸形核心节点与 Blob", () => {
  const base = createWorkspaceArchivePackage(
    {
      core: {
        nodes: [noteNode],
        blobs: [],
        trashSnapshots: [],
        workspace: null,
      },
      plugins: createWorkspaceBackupPackage([], "2026-01-01T00:00:00.000Z"),
    },
    "2026-01-01T00:00:00.000Z",
  )

  assert.throws(
    () =>
      parseWorkspaceArchivePackage(
        JSON.stringify({
          ...base,
          core: { ...base.core, nodes: [{ id: "bad", kind: "note", parentId: null }] },
        }),
      ),
    /nodes\[0\]\.sortKey/,
  )

  assert.throws(
    () =>
      parseWorkspaceArchivePackage(
        JSON.stringify({
          ...base,
          core: { ...base.core, blobs: [{ key: "b1", mime: "", size: 4, dataBase64: "YQ==" }] },
        }),
      ),
    /size 与 dataBase64 不一致/,
  )
})
