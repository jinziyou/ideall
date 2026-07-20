import { test } from "node:test"
import assert from "node:assert/strict"
import {
  BUILTIN_APP_SURFACES,
  CORE_FILE_ROOTS,
  coreFileRootForRef,
  defaultFileForPath,
  fileRootRef,
  normalizeNavigationRootId,
} from "./file-roots"
import { navigationDirectoryRef } from "@/filesystem/navigation-file-system"

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

test("file roots: 只接受五分区与动态挂载 roots", () => {
  const expected = {
    home: "home",
    activity: "activity",
    apps: "apps",
    browse: "browse",
    settings: "settings",
    "mount:third-party.demo:root": "apps",
  } as const

  for (const [rootId, sectionId] of Object.entries(expected)) {
    assert.equal(normalizeNavigationRootId(rootId), sectionId, rootId)
  }
})

test("file roots: 一级根引用导航 FileSystem 目录而不是业务 place 代理", () => {
  for (const root of CORE_FILE_ROOTS) {
    assert.deepEqual(fileRootRef(root.id), navigationDirectoryRef(root.id))
    assert.equal(coreFileRootForRef(navigationDirectoryRef(root.id))?.id, root.id)
  }
  assert.equal(coreFileRootForRef({ fileSystemId: "ideall.core", fileId: "place:home" }), null)
})

test("file roots: 规范路径打开真实目录及其语义 Engine", () => {
  const fixtures = [
    {
      paths: ["/home/following"],
      ref: { fileSystemId: "ideall.core", fileId: "place:subscriptions" },
      engineId: "ideall.subscriptions",
      rootId: "home",
      navigationPath: "/home/following",
    },
    {
      paths: ["/home/bookmarks"],
      ref: { fileSystemId: "ideall.core", fileId: "place:bookmarks" },
      engineId: "ideall.bookmarks",
      rootId: "home",
      navigationPath: "/home/bookmarks",
    },
    {
      paths: ["/home/resources"],
      ref: { fileSystemId: "ideall.core", fileId: "place:files" },
      engineId: "ideall.resources",
      rootId: "home",
      navigationPath: "/home/resources",
    },
    {
      paths: ["/activity/deleted"],
      ref: { fileSystemId: "ideall.trash", fileId: "root" },
      engineId: "ideall.trash",
      rootId: "activity",
      navigationPath: "/activity/deleted",
    },
    {
      paths: ["/apps/local-apps"],
      ref: { fileSystemId: "third-party.installed-apps", fileId: "root" },
      engineId: "ideall.installed-apps",
      rootId: "apps",
      navigationPath: "/apps/local-apps",
    },
    {
      paths: ["/activity/spaces"],
      ref: { fileSystemId: "app.agent-config", fileId: "config:workspaces" },
      engineId: "ideall.agent-spaces",
      rootId: "activity",
      navigationPath: "/activity/spaces",
    },
    {
      paths: ["/activity/tasks"],
      ref: { fileSystemId: "app.agent-config", fileId: "config:tasks" },
      engineId: "ideall.agent-tasks",
      rootId: "activity",
      navigationPath: "/activity/tasks",
    },
    {
      paths: ["/settings/basic"],
      ref: { fileSystemId: "app.settings", fileId: "root" },
      engineId: "ideall.settings",
      rootId: "settings",
      navigationPath: "/settings/basic",
    },
    {
      paths: ["/settings/ai"],
      ref: { fileSystemId: "app.agent-config", fileId: "config:settings" },
      engineId: "ideall.agent-settings",
      rootId: "settings",
      navigationPath: "/settings/ai",
    },
  ] as const

  for (const { paths, ...expected } of fixtures) {
    for (const path of paths) {
      assert.deepEqual(defaultFileForPath(path), expected, path)
    }
  }

  assert.deepEqual(defaultFileForPath("/home/following/publisher/example"), {
    ref: { fileSystemId: "ideall.core", fileId: "place:subscriptions" },
    engineId: "ideall.subscriptions",
    rootId: "home",
    navigationPath: "/home/following",
  })
})

test("file roots: legacy app prefixes retain mounted FileSystem fallback targets", () => {
  for (const id of ["database", "git", "audio"] as const) {
    const surface = BUILTIN_APP_SURFACES[id]
    assert.deepEqual(defaultFileForPath(`/${id}`), {
      ref: surface.ref,
      rootId: "apps",
    })
  }
})
