// 路由 → 标签解析测试 (node:test + tsx): descriptorForPath / descriptorForNode 是深链、
// 刷新恢复与路由薄标记 (OpenWorkspaceTab) 的唯一入口, 锁定精确匹配 / 前缀回退 / 非法输入。
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  descriptorForPath,
  descriptorForNode,
  moduleById,
  modulesForMode,
  isModeNeutralModule,
  isModuleVisibleInMode,
  primaryModuleForMode,
  coerceActiveModuleForMode,
} from "./modules"

test("descriptorForPath: 根路径与 /home 落到「我的」概览", () => {
  assert.equal(descriptorForPath("/")?.kind, "home-overview")
  assert.equal(descriptorForPath("/home")?.kind, "home-overview")
  assert.equal(descriptorForPath("/home/未知子路径")?.kind, "home-overview", "home 前缀兜底")
})

test("descriptorForPath: 精确匹配各模块面板路由", () => {
  assert.equal(descriptorForPath("/home/notes")?.kind, "home-notes")
  assert.equal(descriptorForPath("/home/bookmarks")?.kind, "home-bookmarks")
  assert.equal(descriptorForPath("/tool/ai")?.kind, "tool-ai")
  assert.equal(descriptorForPath("/apps")?.kind, "apps")
  assert.equal(descriptorForPath("/browser")?.kind, "browser-view")
  assert.equal(descriptorForPath("/git")?.kind, "git")
  assert.equal(descriptorForPath("/database")?.kind, "database")
  assert.equal(descriptorForPath("/audio")?.kind, "audio")
  assert.equal(descriptorForPath("/code")?.kind, "code")
  assert.equal(descriptorForPath("/trash")?.kind, "trash")
})

test("descriptorForPath: 前缀回退", () => {
  assert.equal(descriptorForPath("/home/subscriptions?x=1".split("?")[0])?.kind, "subscriptions")
  assert.equal(descriptorForPath("/home/settings/anything")?.kind, "home-settings")
  assert.equal(descriptorForPath("/info/entity")?.kind, "info", "info 子路径回退到 info 标签")
  assert.equal(descriptorForPath("/tool/whatever")?.kind, "tool-search")
})

test("descriptorForPath: /home/agent 是虚拟命令路由 → 显式 null; 未知路径 → null; 空串兜底概览", () => {
  assert.equal(descriptorForPath("/home/agent"), null)
  assert.equal(descriptorForPath("/nonexistent"), null)
  assert.equal(descriptorForPath("")?.kind, "home-overview", "空 pathname 兜底到概览")
})

test("descriptorForNode: ?node=kind:id 解析为 entity 级节点标签; 非法/缺失 → null", () => {
  const d = descriptorForNode("?node=note:abc123")
  assert.ok(d)
  assert.equal(d.kind, "node")
  assert.deepEqual(d.params, { kind: "note", id: "abc123" })
  assert.equal(descriptorForNode("?node=badkind:x"), null, "非法 kind 拒收")
  assert.equal(descriptorForNode("?other=1"), null, "无 node 参数")
  assert.equal(descriptorForNode(""), null)
})

test("modulesForMode: 本地/连接各自簇 + crossMode 工具两侧都在", () => {
  const local = modulesForMode("local").map((m) => m.id)
  const connected = modulesForMode("connected").map((m) => m.id)
  assert.deepEqual(local, ["home", "subscriptions", "apps", "plugins", "trash", "tool"])
  assert.deepEqual(connected, ["info", "community", "tool", "browser"])
})

test("isModeNeutralModule: agent 与 crossMode 工具中性, 其余不翻", () => {
  assert.equal(isModeNeutralModule("agent"), true)
  assert.equal(isModeNeutralModule("tool"), true)
  assert.equal(isModeNeutralModule("home"), false)
  assert.equal(isModeNeutralModule("info"), false)
})

test("moduleById: 未知 id 回退首个模块 (不抛错)", () => {
  assert.equal(moduleById("home").id, "home")
  assert.equal(moduleById("不存在" as never).id, "home")
})

test("module visibility: 当前镜头只暴露本模式模块与允许的特殊模块", () => {
  assert.equal(primaryModuleForMode("local"), "home")
  assert.equal(primaryModuleForMode("connected"), "info")
  assert.equal(isModuleVisibleInMode("home", "local"), true)
  assert.equal(isModuleVisibleInMode("plugins", "local"), true)
  assert.equal(isModuleVisibleInMode("shell", "local"), true, "插件子模块通过插件组在本地可见")
  assert.equal(isModuleVisibleInMode("community", "local"), false)
  assert.equal(isModuleVisibleInMode("info", "connected"), true)
  assert.equal(isModuleVisibleInMode("browser", "connected"), true)
  assert.equal(isModuleVisibleInMode("home", "connected"), false)
  assert.equal(isModuleVisibleInMode("shell", "connected"), false)
  assert.equal(isModuleVisibleInMode("agent", "local"), true)
  assert.equal(isModuleVisibleInMode("agent", "connected"), true)
})

test("coerceActiveModuleForMode: 跨模式标签不污染当前镜头侧栏", () => {
  assert.equal(coerceActiveModuleForMode("community", "local", "home"), "home")
  assert.equal(coerceActiveModuleForMode("community", "local", "plugins"), "plugins")
  assert.equal(coerceActiveModuleForMode("community", "local"), "home")
  assert.equal(coerceActiveModuleForMode("home", "connected", "info"), "info")
  assert.equal(coerceActiveModuleForMode("home", "connected"), "info")
  assert.equal(coerceActiveModuleForMode("tool", "local", "home"), "tool", "crossMode 工具两侧可见")
})
