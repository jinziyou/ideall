import { test } from "node:test"
import assert from "node:assert/strict"
import { fileRefKey } from "@protocol/file-system"
import { corePlaceRef } from "@/filesystem/resource-file-system"
import { NAVIGATION_SECTIONS, navigationSectionIdForRoot } from "./navigation-sections"

test("navigation sections: 固定五分区及叶项顺序", () => {
  assert.deepEqual(
    NAVIGATION_SECTIONS.map((section) => [section.label, section.items.map((item) => item.label)]),
    [
      ["我的", ["关注", "书签", "资源", "文件"]],
      ["活动", ["空间", "任务", "删除"]],
      ["浏览", ["新闻", "社区", "浏览器"]],
      ["应用", ["搜索", "本地应用"]],
      ["设置", ["基本", "AI"]],
    ],
  )
})

test("navigation sections: 所有叶项都有唯一稳定文件目标", () => {
  const items = NAVIGATION_SECTIONS.flatMap((section) => section.items)
  assert.equal(new Set(items.map((item) => item.id)).size, items.length)
  assert.equal(new Set(items.map((item) => fileRefKey(item.target.ref))).size, items.length)
  assert.ok(items.every((item) => item.target.engineId))
})

test("navigation sections: 文件是可展开目录且默认打开目录概览", () => {
  const files = NAVIGATION_SECTIONS.find((section) => section.id === "home")?.items.find(
    (item) => item.id === "files",
  )
  assert.deepEqual(files?.target.ref, corePlaceRef("notes"))
  assert.equal(files?.target.kind, "directory")
  assert.equal(files?.target.engineId, "ideall.directory")
})

test("navigation sections: 旧根迁入五分区", () => {
  assert.equal(navigationSectionIdForRoot("subscriptions"), "home")
  assert.equal(navigationSectionIdForRoot("workspace"), "activity")
  assert.equal(navigationSectionIdForRoot("community"), "browse")
  assert.equal(navigationSectionIdForRoot("tool"), "apps")
  assert.equal(navigationSectionIdForRoot("system"), "settings")
  assert.equal(navigationSectionIdForRoot("mount:app.audio"), "apps")
})
