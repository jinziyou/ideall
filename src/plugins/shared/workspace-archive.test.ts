import { test } from "node:test"
import assert from "node:assert/strict"
import type { Node } from "@protocol/node"
import { WORKSPACE_ARCHIVE_LIMITS } from "@protocol/workspace-archive"
import { encryptWorkspaceArchive } from "@/lib/workspace-archive-crypto"
import { createPluginDataPackage, createWorkspaceBackupPackage } from "@/plugins/shared/plugin-data"
import { gitManifest } from "@/plugins/git/manifest"
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
  assert.equal(parsed.version, 2)
  assert.equal(parsed.version === 2 ? parsed.manifest.algorithm : null, "crc32")
  assert.equal(parsed.version === 2 ? parsed.manifest.nodeCount : null, 1)
  assert.equal(isWorkspaceArchiveRaw(raw), true)
  assert.equal(parsed.core.nodes.length, 1)
  assert.equal(parsed.core.blobs[0].dataBase64, "YWJj")
  assert.equal(parsed.core.trashSnapshots[0].id, "n1")
  assert.equal(parsed.core.workspace?.tabs.length, 1)
  assert.equal(parsed.core.workspace?.workspaceKind, "development")
  assert.equal(parsed.core.workspace?.developmentTool, "shell")
  assert.equal("mode" in (parsed.core.workspace ?? {}), false)
  assert.equal(parsed.plugins.plugins[0].plugin.id, "git")

  const preview = await previewWorkspaceArchiveImport(raw, "workspace.json", gitManifest.dataPorts)
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
    /缺少 core/,
  )
})

test("workspace archive: v2 清单拒绝正文篡改和旧版归档", () => {
  const pack = createWorkspaceArchivePackage(
    {
      core: { nodes: [noteNode], blobs: [], trashSnapshots: [], workspace: null },
      plugins: createWorkspaceBackupPackage([], "2026-01-01T00:00:00.000Z"),
    },
    "2026-01-01T00:00:00.000Z",
  )
  const tampered = JSON.parse(stringifyWorkspaceArchivePackage(pack)) as {
    version: number
    manifest?: unknown
    core: { nodes: Array<{ title: string }> }
  }
  tampered.core.nodes[0]!.title = "Tampered"
  assert.throws(() => parseWorkspaceArchivePackage(JSON.stringify(tampered)), /checksum 校验失败/)

  tampered.version = 1
  delete tampered.manifest
  assert.throws(
    () => parseWorkspaceArchivePackage(JSON.stringify(tampered)),
    /不支持的工作区归档 JSON 版本/,
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

test("workspace archive: 在 JSON.parse/Base64 解码前执行资源预算", () => {
  const pack = createWorkspaceArchivePackage(
    {
      core: {
        nodes: [noteNode],
        blobs: [{ key: "f1", mime: "text/plain", size: 3, dataBase64: "YWJj" }],
        trashSnapshots: [],
        workspace: null,
      },
      plugins: createWorkspaceBackupPackage([], "2026-01-01T00:00:00.000Z"),
    },
    "2026-01-01T00:00:00.000Z",
  )
  const raw = stringifyWorkspaceArchivePackage(pack)

  assert.throws(
    () =>
      parseWorkspaceArchivePackage(raw, {
        ...WORKSPACE_ARCHIVE_LIMITS,
        maxPlaintextBytes: 8,
      }),
    /工作区归档过大/,
  )
  assert.throws(
    () =>
      parseWorkspaceArchivePackage(raw, {
        ...WORKSPACE_ARCHIVE_LIMITS,
        maxNodes: 0,
      }),
    /core\.nodes 数量 超出归档限制/,
  )
  assert.throws(
    () =>
      stringifyWorkspaceArchivePackage(pack, {
        ...WORKSPACE_ARCHIVE_LIMITS,
        maxSingleBlobBytes: 2,
      }),
    /Blob\[0\]\.size 超出归档限制/,
  )
})

test("workspace archive: 加密归档必须通过口令预检", async () => {
  const pack = createWorkspaceArchivePackage(
    {
      core: { nodes: [noteNode], blobs: [], trashSnapshots: [], workspace: null },
      plugins: createWorkspaceBackupPackage([], "2026-01-01T00:00:00.000Z"),
    },
    "2026-01-01T00:00:00.000Z",
  )
  const encrypted = await encryptWorkspaceArchive(
    stringifyWorkspaceArchivePackage(pack),
    "correct horse battery staple",
  )

  const missing = await previewWorkspaceArchiveImport(encrypted, "encrypted.json")
  assert.equal(missing.encrypted, true)
  assert.equal(missing.requiresPassphrase, true)
  assert.match(missing.error ?? "", /请输入归档口令/)

  const wrong = await previewWorkspaceArchiveImport(
    encrypted,
    "encrypted.json",
    undefined,
    "incorrect password value",
  )
  assert.equal(wrong.ok, false)
  assert.match(wrong.error ?? "", /口令错误或加密归档已损坏/)

  const valid = await previewWorkspaceArchiveImport(
    encrypted,
    "encrypted.json",
    undefined,
    "correct horse battery staple",
  )
  assert.equal(valid.ok, true)
  assert.equal(valid.encrypted, true)
  assert.equal(valid.requiresPassphrase, false)
  assert.equal(valid.archive?.nodeCount, 1)
})
