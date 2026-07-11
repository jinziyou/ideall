import { test } from "node:test"
import assert from "node:assert/strict"
import { MODULES } from "./modules"
import { parseFileEngineTabParams } from "./file-tab"
import {
  isStaticTabKind,
  tabDefinitionLayout,
  tabDefinitionViewType,
  tabDescriptor,
} from "./tab-definitions"

test("tabDescriptor: 从单一 Tab 定义生成默认 descriptor", () => {
  assert.deepEqual(tabDescriptor("tool-ai"), {
    kind: "tool-ai",
    module: "tool",
    title: "AI 网站",
    path: "/tool/ai",
  })
})

test("tabDescriptor: 支持保留 kind 但覆盖 module/title/params/path", () => {
  assert.deepEqual(tabDescriptor("subscriptions", { module: "home", path: undefined }), {
    kind: "subscriptions",
    module: "home",
    title: "关注",
    path: undefined,
  })
  assert.deepEqual(
    tabDescriptor("ai-tasks", { title: "默认工作区", params: { workspaceId: "w1" } }),
    {
      kind: "ai-tasks",
      module: "agent",
      title: "默认工作区",
      params: { workspaceId: "w1" },
    },
  )
})

test("tab definitions: layout 与视图分类由 kind 单源推导", () => {
  assert.equal(tabDefinitionLayout("browser-view"), "fill")
  assert.equal(tabDefinitionLayout("home-bookmarks"), "padded")
  assert.equal(tabDefinitionViewType("home-overview"), "overview")
  assert.equal(tabDefinitionViewType("ai-settings"), "config")
  assert.equal(tabDefinitionViewType("tool-search"), "panel")
})

test("workspace modules: 所有入口都是文件视图、Resource 兼容文件或已注册静态 Tab", () => {
  const missing = MODULES.flatMap((module) =>
    module.entries.filter(
      (entry) =>
        entry.descriptor.kind !== "resource" &&
        !isStaticTabKind(entry.descriptor.kind) &&
        !(
          entry.descriptor.kind === "file-engine" &&
          parseFileEngineTabParams(entry.descriptor.params) !== null
        ),
    ),
  )
  assert.deepEqual(missing, [])
})
