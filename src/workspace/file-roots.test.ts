import { test } from "node:test"
import assert from "node:assert/strict"
import type { DirectoryEntry } from "@protocol/file-system"
import {
  BUILTIN_APP_SURFACES,
  CORE_FILE_ROOTS,
  defaultFileForPath,
  mountedFileRootId,
  rootEntriesForMode,
} from "./file-roots"

const parent = { fileSystemId: "ideall.root", fileId: "root" }

function entry(entryId: string, properties?: Readonly<Record<string, unknown>>): DirectoryEntry {
  return {
    entryId,
    parent,
    target: { fileSystemId: `test.${entryId}`, fileId: "root" },
    name: entryId,
    kind: entryId.startsWith("mount.") ? "mount" : "link",
    properties,
  }
}

test("root entries: 合成根保持完整，Display 按本地/连接镜头过滤", () => {
  const entries = [
    ...CORE_FILE_ROOTS.map((root) => entry(root.id)),
    entry("mount.local"),
    entry("mount.connected", { workspaceModes: ["connected"] }),
    entry("mount.shared", { workspaceModes: ["local", "connected"] }),
  ]

  assert.deepEqual(
    rootEntriesForMode(entries, "local").map((item) => item.entryId),
    ["home", "subscriptions", "apps", "tool", "mount.local", "mount.shared"],
  )
  assert.deepEqual(
    rootEntriesForMode(entries, "connected").map((item) => item.entryId),
    ["info", "community", "browser", "tool", "mount.connected", "mount.shared"],
  )
  assert.equal(entries.length, CORE_FILE_ROOTS.length + 3, "过滤不能修改合成根目录")
})

test("file roots: database/git/audio routes target their mounted FileSystem roots", () => {
  for (const id of ["database", "git", "audio"] as const) {
    const surface = BUILTIN_APP_SURFACES[id]
    assert.deepEqual(defaultFileForPath(`/${id}`), {
      ref: surface.ref,
      rootId: mountedFileRootId(surface.ref),
    })
  }
})
