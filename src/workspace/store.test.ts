// 工作区标签「激活来源」单测 (node:test + tsx): 守 agent 经 ui.openTab 自激活不计入隐式同意 (隐私)。
// 背景: active-node 端口仅对 source==="user" 的激活节点回 NodeRef; agent 自激活回 null ——
// 防 agent ui.openTab 任意笔记 → 下一轮 referenced-context 自喂其正文给模型 (软绕 fs.notes:read consent)。
import { test } from "node:test"
import assert from "node:assert/strict"

import {
  openTab,
  openNodeTab,
  promoteTab,
  promoteActiveTab,
  toggleModule,
  setMode,
  closeTab,
  closeAllTabs,
  setActiveTab,
  getActiveId,
  getActiveSource,
  getTransientId,
  getMode,
  getTabs,
} from "./store"

// —— 标签描述符夹具 (本地/连接各取一个 + 跨模式工具) ——
const HOME = { kind: "home-overview", module: "home", title: "概览", path: "/home" } as const
const INFO = { kind: "info", module: "info", title: "资讯", path: "/info" } as const
const TOOL = { kind: "tool-search", module: "tool", title: "搜索", path: "/tool/search" } as const

test("openNodeTab 默认来源 user; 传 agent 标记 agent", () => {
  openNodeTab({ kind: "note", id: "u1" }, "用户开")
  assert.equal(getActiveSource(), "user")
  openNodeTab({ kind: "note", id: "a1" }, "AI 开", "agent")
  assert.equal(getActiveSource(), "agent", "agent 经 ui.openTab 自激活 → 来源 agent")
})

test("用户点回 agent 开的标签 → 来源转 user (用户主动看 = 同意)", () => {
  openNodeTab({ kind: "note", id: "x" }, "X", "agent")
  assert.equal(getActiveSource(), "agent")
  const id = getActiveId()
  assert.ok(id)
  setActiveTab(id!)
  assert.equal(getActiveSource(), "user", "用户点击该标签 → 视作同意")
})

test("用户经侧栏/搜索再开别的节点 → 来源回 user (不被前一个 agent 态污染)", () => {
  openNodeTab({ kind: "note", id: "a2" }, "AI 开2", "agent")
  assert.equal(getActiveSource(), "agent")
  openNodeTab({ kind: "file", id: "f1" }, "用户开文件") // 默认 user
  assert.equal(getActiveSource(), "user")
})

// —— VS Code 式预览/瞬态标签 (一切皆标签但不堆爆) ——

test("单击预览: transient 打开建立单一预览槽", () => {
  closeAllTabs()
  openNodeTab({ kind: "note", id: "p1" }, "P1", "user", { transient: true })
  assert.equal(getTabs().length, 1)
  assert.equal(getTransientId(), getActiveId())
})

test("再次预览不同项 → 原地替换预览槽 (标签数不增)", () => {
  closeAllTabs()
  openNodeTab({ kind: "note", id: "a" }, "A", "user", { transient: true })
  openNodeTab({ kind: "note", id: "b" }, "B", "user", { transient: true })
  assert.equal(getTabs().length, 1, "预览槽被复用, 不累积")
  assert.equal(getTransientId(), getActiveId())
})

test("非瞬态打开命中预览槽 → 提升为常驻 (transientId 清空)", () => {
  closeAllTabs()
  openNodeTab({ kind: "note", id: "c" }, "C", "user", { transient: true })
  const id = getActiveId()!
  openNodeTab({ kind: "note", id: "c" }, "C", "user") // 双击/键盘 = 钉住
  assert.equal(getTransientId(), null)
  assert.equal(getTabs().length, 1)
  assert.equal(getActiveId(), id)
})

test("promoteTab 仅对当前预览标签生效", () => {
  closeAllTabs()
  openNodeTab({ kind: "note", id: "d" }, "D", "user", { transient: true })
  const id = getActiveId()!
  promoteTab("不存在的-id")
  assert.equal(getTransientId(), id, "对非预览 id 无效")
  promoteTab(id)
  assert.equal(getTransientId(), null)
})

test("promoteActiveTab: 编辑即钉住 —— 激活的预览标签提升为常驻", () => {
  closeAllTabs()
  openNodeTab({ kind: "note", id: "ed" }, "编辑", "user", { transient: true })
  const id = getActiveId()!
  assert.equal(getTransientId(), id)
  promoteActiveTab()
  assert.equal(getTransientId(), null, "激活的预览标签被钉为常驻")
  promoteActiveTab() // 幂等
  assert.equal(getTransientId(), null)
})

test("promoteActiveTab: 激活标签非预览时不动预览槽", () => {
  closeAllTabs()
  openNodeTab({ kind: "note", id: "prev2" }, "预览", "user", { transient: true })
  const previewId = getTransientId()!
  openNodeTab({ kind: "file", id: "perm" }, "常驻", "user") // 激活变常驻, 预览槽仍是 prev2
  assert.notEqual(getActiveId(), previewId)
  promoteActiveTab()
  assert.equal(getTransientId(), previewId, "激活非预览 → 预览槽不变")
})

test("常驻打开新标签不消耗预览槽; 关闭预览标签清空 transientId", () => {
  closeAllTabs()
  openNodeTab({ kind: "note", id: "e" }, "E", "user", { transient: true }) // 预览 E
  const previewId = getTransientId()!
  openNodeTab({ kind: "file", id: "f" }, "F", "user") // 常驻 F (新标签)
  assert.equal(getTabs().length, 2, "常驻打开追加, 不替换预览槽")
  assert.equal(getTransientId(), previewId, "预览槽仍是 E")
  closeTab(previewId)
  assert.equal(getTransientId(), null, "关闭预览标签 → 清空")
})

test("软上限: 常驻标签超过上限 → 回收最久未用的冷标签 (激活项保留)", () => {
  closeAllTabs()
  // 开 13 个常驻笔记标签 (上限 12): 第一个 (最久未访问) 应被自动回收。
  openNodeTab({ kind: "note", id: "cap-0" }, "0", "user")
  const firstId = getActiveId()!
  for (let i = 1; i <= 12; i++) openNodeTab({ kind: "note", id: `cap-${i}` }, String(i), "user")
  const tabs = getTabs()
  assert.equal(tabs.length, 12, "常驻标签数被钳在软上限")
  assert.ok(!tabs.some((t) => t.id === firstId), "最久未用的标签被回收")
  assert.equal(getActiveId(), tabs[tabs.length - 1].id, "最新打开的仍是激活项, 未被回收")
})

test("软上限: 预览标签不计入上限, 也不被回收", () => {
  closeAllTabs()
  openNodeTab({ kind: "note", id: "prev" }, "预览", "user", { transient: true })
  const previewId = getTransientId()!
  for (let i = 0; i < 12; i++) openNodeTab({ kind: "note", id: `p-${i}` }, String(i), "user")
  const tabs = getTabs()
  // 12 个常驻 + 1 个预览 = 13, 但预览不计入上限故不触发回收。
  assert.equal(tabs.length, 13, "预览标签不计入上限")
  assert.ok(
    tabs.some((t) => t.id === previewId),
    "预览标签未被回收",
  )
  assert.equal(getTransientId(), previewId)
})

// —— 本地/连接 模式镜头 (恢复的双模式) ——

test("openTab 同步模式镜头: 连接模块→connected, 本地模块→local", () => {
  closeAllTabs()
  openTab(INFO)
  assert.equal(getMode(), "connected")
  openTab(HOME)
  assert.equal(getMode(), "local")
})

test("crossMode 工具是 mode-中性: 打开不翻镜头 (两个方向)", () => {
  closeAllTabs()
  openTab(INFO) // connected
  openTab(TOOL) // 中性
  assert.equal(getMode(), "connected", "连接态下开工具仍连接")
  openTab(HOME) // local
  openTab(TOOL) // 中性
  assert.equal(getMode(), "local", "本地态下开工具仍本地")
})

test("setMode 切镜头并落到该模式首个模块; 同模式则无操作", () => {
  closeAllTabs()
  openTab(HOME) // local
  setMode("connected")
  assert.equal(getMode(), "connected")
  const active = getTabs().find((t) => t.id === getActiveId())
  assert.equal(active?.kind, "info", "连接模式落到资讯")
  const before = getActiveId()
  setMode("connected") // 已是该模式 → 无操作
  assert.equal(getActiveId(), before, "点已激活模式不打扰当前标签")
})

test("setActiveTab 跟随模式; mode-中性标签激活不翻镜头", () => {
  closeAllTabs()
  openTab(INFO) // connected
  openTab(HOME) // local, 现激活 home
  const infoId = getTabs().find((t) => t.kind === "info")!.id
  setActiveTab(infoId)
  assert.equal(getMode(), "connected", "点回资讯标签 → 连接")
  openTab(TOOL) // 中性, 不翻 → 仍 connected
  const toolId = getTabs().find((t) => t.kind === "tool-search")!.id
  openTab(HOME) // local
  setActiveTab(toolId) // 激活中性工具 → 保留当前 (local) 镜头
  assert.equal(getMode(), "local", "激活中性工具不翻镜头")
})

test("closeTab: 焦点转移到相邻标签时同步镜头", () => {
  closeAllTabs()
  openTab(HOME) // local, tab0
  openTab(INFO) // connected, tab1 (激活)
  assert.equal(getMode(), "connected")
  closeTab(getActiveId()!) // 关 info → 焦点回 home
  assert.equal(getMode(), "local", "焦点落到 home → 本地")
})
