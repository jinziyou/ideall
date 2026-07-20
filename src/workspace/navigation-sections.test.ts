import { test } from "node:test"
import assert from "node:assert/strict"
import type { DirectoryEntry } from "@protocol/file-system"
import {
  NAVIGATION_SECTIONS,
  navigationSectionForEntry,
  navigationSectionIdForRoot,
} from "./navigation-sections"

test("navigation sections: Display 只保留固定分区装饰与路径回退", () => {
  assert.deepEqual(
    NAVIGATION_SECTIONS.map((section) => [section.id, section.label, section.path]),
    [
      ["home", "我的", "/home"],
      ["activity", "活动", "/activity"],
      ["browse", "浏览", "/browse"],
      ["apps", "应用", "/apps"],
      ["settings", "设置", "/settings"],
    ],
  )
  assert.ok(NAVIGATION_SECTIONS.every((section) => !("items" in section)))
})

test("navigation sections: 可见名称与路径由根目录 link 覆盖", () => {
  const entry: DirectoryEntry = {
    entryId: "home",
    pathName: "home",
    name: "个人空间",
    parent: { fileSystemId: "ideall.root", fileId: "root" },
    target: { fileSystemId: "ideall.navigation", fileId: "/home" },
    kind: "link",
    properties: { navigationSection: "home", iconHint: "home" },
  }
  const section = navigationSectionForEntry(entry)
  assert.equal(section?.label, "个人空间")
  assert.equal(section?.path, "/home")
})

test("navigation sections: 只接受当前分区与动态挂载根", () => {
  assert.equal(navigationSectionIdForRoot("home"), "home")
  assert.equal(navigationSectionIdForRoot("activity"), "activity")
  assert.equal(navigationSectionIdForRoot("browse"), "browse")
  assert.equal(navigationSectionIdForRoot("apps"), "apps")
  assert.equal(navigationSectionIdForRoot("settings"), "settings")
  assert.equal(navigationSectionIdForRoot("mount:app.audio"), "apps")
  assert.equal(navigationSectionIdForRoot("subscriptions"), "home")
  assert.equal(navigationSectionIdForRoot("workspace"), "home")
  assert.equal(navigationSectionIdForRoot("community"), "home")
  assert.equal(navigationSectionIdForRoot("tool"), "home")
  assert.equal(navigationSectionIdForRoot("system"), "home")
})
