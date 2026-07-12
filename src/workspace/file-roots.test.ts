import { test } from "node:test"
import assert from "node:assert/strict"
import {
  BUILTIN_APP_SURFACES,
  CORE_FILE_ROOTS,
  defaultFileForPath,
  normalizeNavigationRootId,
} from "./file-roots"

test("file roots: 一级导航固定为五个分区", () => {
  assert.deepEqual(
    CORE_FILE_ROOTS.map((root) => [root.id, root.label]),
    [
      ["home", "我的"],
      ["activity", "活动"],
      ["browse", "浏览"],
      ["apps", "应用"],
      ["settings", "设置"],
    ],
  )
})

test("file roots: 旧细粒度 roots 归一到五分区", () => {
  const expected = {
    home: "home",
    subscriptions: "home",
    bookmarks: "home",
    files: "home",
    notes: "home",
    workspace: "activity",
    apps: "apps",
    info: "browse",
    community: "browse",
    browser: "browse",
    tool: "apps",
    system: "settings",
    "mount:third-party.demo:root": "apps",
  } as const

  for (const [rootId, sectionId] of Object.entries(expected)) {
    assert.equal(normalizeNavigationRootId(rootId), sectionId, rootId)
  }
})

test("file roots: database/git/audio routes target their mounted FileSystem roots", () => {
  for (const id of ["database", "git", "audio"] as const) {
    const surface = BUILTIN_APP_SURFACES[id]
    assert.deepEqual(defaultFileForPath(`/${id}`), {
      ref: surface.ref,
      rootId: "apps",
    })
  }
})
