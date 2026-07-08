// 工作区标签「激活来源」单测 (node:test + tsx): 守 agent 经 ui.openTab 自激活不计入隐式同意 (隐私)。
// 背景: active-node 端口仅对 source==="user" 的激活节点回 NodeRef; agent 自激活回 null ——
// 防 agent ui.openTab 任意笔记 → 下一轮 referenced-context 自喂其正文给模型 (软绕 fs.notes:read consent)。
import { test } from "node:test"
import assert from "node:assert/strict"
import { resourceKey } from "@protocol/resource"

import {
  openTab,
  openTarget,
  promoteTab,
  promoteActiveTab,
  toggleModule,
  setMode,
  closeTab,
  closeAllTabs,
  closeActiveTab,
  requestCloseTab,
  setActiveTab,
  subscribeDirtyTabCloseRequests,
  type DirtyTabCloseRequest,
  activateAdjacentTab,
  activateTabAt,
  isTabDirty,
  setTabDirty,
  getActiveId,
  getActiveSource,
  getTransientId,
  getMode,
  getActiveModule,
  getTabs,
  type ActiveSource,
} from "./store"
import type { NodeRef } from "./node-ref"
import { tabDescriptor } from "./tab-definitions"
import { clearVfsProvidersForTest, registerVfsProvider } from "@/vfs/registry"
import type { VfsProvider } from "@/vfs/types"

// —— 标签描述符夹具 (本地/连接各取一个 + 跨模式工具) ——
const HOME = tabDescriptor("home-overview")
const INFO = tabDescriptor("info")
const COMMUNITY = tabDescriptor("community")
const TOOL = tabDescriptor("tool-search")

function openNodeResource(
  ref: NodeRef,
  title: string,
  source: ActiveSource = "user",
  opts?: { transient?: boolean },
) {
  return openTarget(
    { type: "resource", ref: { scheme: "node", ...ref }, title, transient: opts?.transient },
    source,
  )
}

test("openTarget node resource 默认来源 user; 传 agent 标记 agent", () => {
  openNodeResource({ kind: "note", id: "u1" }, "用户开")
  assert.equal(getActiveSource(), "user")
  openNodeResource({ kind: "note", id: "a1" }, "AI 开", "agent")
  assert.equal(getActiveSource(), "agent", "agent 经 ui.openTab 自激活 → 来源 agent")
})

test("openTarget(resource): node Resource 打开统一 resource 标签并写入新 resource 深链", () => {
  closeAllTabs()
  assert.equal(
    openTarget(
      {
        type: "resource",
        ref: { scheme: "node", kind: "file", id: "r1" },
        title: "readme.md",
        transient: true,
      },
      "agent",
    ),
    true,
  )
  const tab = getTabs()[0]
  assert.equal(tab.kind, "resource")
  assert.deepEqual(tab.params, {
    resource: resourceKey({ scheme: "node", kind: "file", id: "r1" }),
  })
  assert.equal(tab.title, "readme.md")
  assert.ok(tab.path?.startsWith("/home/notes?resource="))
  assert.equal(getTransientId(), tab.id)
  assert.equal(getActiveSource(), "agent")
  assert.equal(
    openTarget({ type: "resource", ref: { scheme: "tool", kind: "search", id: "default" } }),
    true,
  )
  assert.equal(getTabs().at(-1)?.kind, "resource")
  assert.deepEqual(getTabs().at(-1)?.params, {
    resource: resourceKey({ scheme: "tool", kind: "search", id: "default" }),
  })
})

test("openTarget(resource): refreshes descriptor title from VFS metadata", async () => {
  closeAllTabs()
  clearVfsProvidersForTest()
  const provider: VfsProvider = {
    scheme: "tool",
    async list() {
      return { items: [] }
    },
    async get(ref) {
      return {
        meta: {
          ref,
          title: "VFS Search",
          route: "/tool/search",
          capabilities: ["open", "preview", "navigate"],
        },
        content: { route: "/tool/search" },
      }
    },
    async actions() {
      return []
    },
    async invoke() {
      return null
    },
  }
  const unregister = registerVfsProvider(provider)

  try {
    assert.equal(
      openTarget({
        type: "resource",
        ref: { scheme: "tool", kind: "search", id: "default" },
        title: "Fallback Search",
      }),
      true,
    )
    assert.equal(getTabs().at(-1)?.title, "Fallback Search")

    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.equal(getTabs().at(-1)?.title, "VFS Search")
  } finally {
    unregister()
    clearVfsProvidersForTest()
  }
})

test("用户点回 agent 开的标签 → 来源转 user (用户主动看 = 同意)", () => {
  openNodeResource({ kind: "note", id: "x" }, "X", "agent")
  assert.equal(getActiveSource(), "agent")
  const id = getActiveId()
  assert.ok(id)
  setActiveTab(id!)
  assert.equal(getActiveSource(), "user", "用户点击该标签 → 视作同意")
})

test("用户经侧栏/搜索再开别的节点 → 来源回 user (不被前一个 agent 态污染)", () => {
  openNodeResource({ kind: "note", id: "a2" }, "AI 开2", "agent")
  assert.equal(getActiveSource(), "agent")
  openNodeResource({ kind: "file", id: "f1" }, "用户开文件") // 默认 user
  assert.equal(getActiveSource(), "user")
})

// —— VS Code 式预览/瞬态标签 (一切皆标签但不堆爆) ——

test("单击预览: transient 打开建立单一预览槽", () => {
  closeAllTabs()
  openNodeResource({ kind: "note", id: "p1" }, "P1", "user", { transient: true })
  assert.equal(getTabs().length, 1)
  assert.equal(getTransientId(), getActiveId())
})

test("再次预览不同项 → 原地替换预览槽 (标签数不增)", () => {
  closeAllTabs()
  openNodeResource({ kind: "note", id: "a" }, "A", "user", { transient: true })
  openNodeResource({ kind: "note", id: "b" }, "B", "user", { transient: true })
  assert.equal(getTabs().length, 1, "预览槽被复用, 不累积")
  assert.equal(getTransientId(), getActiveId())
})

test("非瞬态打开命中预览槽 → 提升为常驻 (transientId 清空)", () => {
  closeAllTabs()
  openNodeResource({ kind: "note", id: "c" }, "C", "user", { transient: true })
  const id = getActiveId()!
  openNodeResource({ kind: "note", id: "c" }, "C", "user") // 双击/键盘 = 钉住
  assert.equal(getTransientId(), null)
  assert.equal(getTabs().length, 1)
  assert.equal(getActiveId(), id)
})

test("promoteTab 仅对当前预览标签生效", () => {
  closeAllTabs()
  openNodeResource({ kind: "note", id: "d" }, "D", "user", { transient: true })
  const id = getActiveId()!
  promoteTab("不存在的-id")
  assert.equal(getTransientId(), id, "对非预览 id 无效")
  promoteTab(id)
  assert.equal(getTransientId(), null)
})

test("promoteActiveTab: 编辑即钉住 —— 激活的预览标签提升为常驻", () => {
  closeAllTabs()
  openNodeResource({ kind: "note", id: "ed" }, "编辑", "user", { transient: true })
  const id = getActiveId()!
  assert.equal(getTransientId(), id)
  promoteActiveTab()
  assert.equal(getTransientId(), null, "激活的预览标签被钉为常驻")
  promoteActiveTab() // 幂等
  assert.equal(getTransientId(), null)
})

test("promoteActiveTab: 激活标签非预览时不动预览槽", () => {
  closeAllTabs()
  openNodeResource({ kind: "note", id: "prev2" }, "预览", "user", { transient: true })
  const previewId = getTransientId()!
  openNodeResource({ kind: "file", id: "perm" }, "常驻", "user") // 激活变常驻, 预览槽仍是 prev2
  assert.notEqual(getActiveId(), previewId)
  promoteActiveTab()
  assert.equal(getTransientId(), previewId, "激活非预览 → 预览槽不变")
})

test("常驻打开新标签不消耗预览槽; 关闭预览标签清空 transientId", () => {
  closeAllTabs()
  openNodeResource({ kind: "note", id: "e" }, "E", "user", { transient: true }) // 预览 E
  const previewId = getTransientId()!
  openNodeResource({ kind: "file", id: "f" }, "F", "user") // 常驻 F (新标签)
  assert.equal(getTabs().length, 2, "常驻打开追加, 不替换预览槽")
  assert.equal(getTransientId(), previewId, "预览槽仍是 E")
  closeTab(previewId)
  assert.equal(getTransientId(), null, "关闭预览标签 → 清空")
})

test("软上限: 常驻标签超过上限 → 回收最久未用的冷标签 (激活项保留)", () => {
  closeAllTabs()
  // 开 13 个常驻笔记标签 (上限 12): 第一个 (最久未访问) 应被自动回收。
  openNodeResource({ kind: "note", id: "cap-0" }, "0", "user")
  const firstId = getActiveId()!
  for (let i = 1; i <= 12; i++) openNodeResource({ kind: "note", id: `cap-${i}` }, String(i), "user")
  const tabs = getTabs()
  assert.equal(tabs.length, 12, "常驻标签数被钳在软上限")
  assert.ok(!tabs.some((t) => t.id === firstId), "最久未用的标签被回收")
  assert.equal(getActiveId(), tabs[tabs.length - 1].id, "最新打开的仍是激活项, 未被回收")
})

test("软上限: 预览标签不计入上限, 也不被回收", () => {
  closeAllTabs()
  openNodeResource({ kind: "note", id: "prev" }, "预览", "user", { transient: true })
  const previewId = getTransientId()!
  for (let i = 0; i < 12; i++) openNodeResource({ kind: "note", id: `p-${i}` }, String(i), "user")
  const tabs = getTabs()
  // 12 个常驻 + 1 个预览 = 13, 但预览不计入上限故不触发回收。
  assert.equal(tabs.length, 13, "预览标签不计入上限")
  assert.ok(
    tabs.some((t) => t.id === previewId),
    "预览标签未被回收",
  )
  assert.equal(getTransientId(), previewId)
})

test("dirty 标签: 受保护关闭会询问, 拒绝时保留标签与 dirty 状态", () => {
  closeAllTabs()
  openNodeResource({ kind: "file", id: "dirty" }, "dirty.ts")
  const id = getActiveId()!
  setTabDirty(id, true)
  assert.equal(isTabDirty(id), true)

  const closeRequests: DirtyTabCloseRequest[] = []
  const unsubscribe = subscribeDirtyTabCloseRequests((request) => {
    assert.equal(request.title, "关闭未保存的标签？")
    assert.match(request.description, /dirty\.ts」 有未保存更改/)
    closeRequests.push(request)
  })
  assert.equal(requestCloseTab(id), false)
  assert.ok(
    getTabs().some((t) => t.id === id),
    "拒绝关闭 → 标签仍在",
  )
  assert.equal(isTabDirty(id), true)

  assert.equal(closeRequests.length, 1)
  closeRequests[0].confirm()
  assert.ok(!getTabs().some((t) => t.id === id), "确认关闭 → 标签移除")
  assert.equal(isTabDirty(id), false, "关闭后 dirty 标记同步清理")
  unsubscribe()
})

test("dirty 标签: 常驻软上限回收时跳过未保存标签", () => {
  closeAllTabs()
  openNodeResource({ kind: "file", id: "keep-dirty" }, "keep.ts")
  const dirtyId = getActiveId()!
  setTabDirty(dirtyId, true)
  for (let i = 0; i < 12; i++) openNodeResource({ kind: "note", id: `clean-${i}` }, String(i))
  const tabs = getTabs()
  assert.equal(tabs.length, 12)
  assert.ok(
    tabs.some((t) => t.id === dirtyId),
    "未保存标签不被软上限回收",
  )
  assert.equal(isTabDirty(dirtyId), true)
})

// —— 本地/连接 模式镜头 (仅显式导航切换; 打开/激活/关闭标签不翻转) ——

test("openTab / setActiveTab 不翻镜头, 也不污染当前镜头侧栏模块", () => {
  closeAllTabs()
  setMode("local")
  assert.equal(getMode(), "local")
  assert.equal(getActiveModule(), "home")
  openTab(COMMUNITY) // 连接模块 → 打开但不翻镜头, activeModule 保持本地可见
  assert.equal(getMode(), "local", "打开连接模块标签不翻镜头")
  assert.equal(getActiveModule(), "home", "连接标签不会在本地活动栏生成幽灵模块")
  openTab(HOME)
  const communityId = getTabs().find((t) => t.kind === "community")!.id
  setActiveTab(communityId)
  assert.equal(getMode(), "local", "激活连接标签也不翻镜头")
  assert.equal(getActiveModule(), "home", "激活连接标签不污染本地侧栏模块")
  openTab(TOOL) // crossMode 工具可在两侧镜头中作为当前侧栏模块
  assert.equal(getMode(), "local")
  assert.equal(getActiveModule(), "tool")
})

test("toggleModule 显式模块导航才切镜头; 中性工具除外", () => {
  closeAllTabs()
  toggleModule("community")
  assert.equal(getMode(), "connected", "点活动栏模块图标 = 显式切视图")
  assert.equal(getActiveModule(), "community")
  toggleModule("home")
  assert.equal(getMode(), "local")
  assert.equal(getActiveModule(), "home")
  toggleModule("tool") // crossMode 中性: 不翻
  assert.equal(getMode(), "local", "跨模式工具不翻镜头")
  assert.equal(getActiveModule(), "tool")
})

test("setMode 切镜头并落到该模式首个模块; 同模式仅做污染态归一", () => {
  closeAllTabs()
  setMode("local") // 归位 (上个测试结束在 local, 幂等)
  openTab(HOME)
  setMode("connected")
  assert.equal(getMode(), "connected")
  assert.equal(getActiveModule(), "info")
  const active = getTabs().find((t) => t.id === getActiveId())
  assert.equal(active?.kind, "resource", "连接模式落到资讯资源")
  assert.deepEqual(active?.params, {
    resource: resourceKey({ scheme: "info", kind: "home", id: "default" }),
  })
  const before = getActiveId()
  setMode("connected") // 已是该模式 → 无操作
  assert.equal(getActiveId(), before, "点已激活模式不打扰当前标签")
})

test("closeTab: 焦点转移不翻镜头, activeModule 收束到当前镜头", () => {
  closeAllTabs()
  assert.equal(getMode(), "connected") // 上个测试结束在 connected
  openTab(HOME) // local 模块, 打开不翻, 连接镜头侧栏仍保持 info
  assert.equal(getActiveModule(), "info")
  openTab(INFO)
  closeTab(getActiveId()!) // 关 info → 焦点回 home
  const active = getTabs().find((t) => t.id === getActiveId())
  assert.equal(active?.kind, "home-overview", "焦点转移到相邻标签")
  assert.equal(getMode(), "connected", "镜头保持, 不随焦点翻转")
  assert.equal(getActiveModule(), "info", "本地标签不会污染连接镜头侧栏模块")
})

// —— 键盘导航动作 (全局快捷键用) ——

test("activateAdjacentTab 按标签序循环; activateTabAt 按序跳转 (9=最后)", () => {
  closeAllTabs()
  openNodeResource({ kind: "note", id: "k1" }, "K1")
  openNodeResource({ kind: "note", id: "k2" }, "K2")
  openNodeResource({ kind: "note", id: "k3" }, "K3")
  const ids = getTabs().map((t) => t.id)
  assert.equal(getActiveId(), ids[2])
  activateAdjacentTab(1) // 尾部 → 循环回头
  assert.equal(getActiveId(), ids[0])
  activateAdjacentTab(-1) // 头部 → 循环到尾
  assert.equal(getActiveId(), ids[2])
  activateTabAt(2)
  assert.equal(getActiveId(), ids[1])
  activateTabAt(9) // 浏览器惯例: 9 = 最后一个
  assert.equal(getActiveId(), ids[2])
})

test("closeActiveTab 关闭激活标签; 无标签时安全无操作", () => {
  closeAllTabs()
  closeActiveTab() // 空态无操作不抛
  openNodeResource({ kind: "note", id: "cw1" }, "CW1")
  openNodeResource({ kind: "note", id: "cw2" }, "CW2")
  closeActiveTab()
  assert.equal(getTabs().length, 1)
  assert.equal(getTabs()[0].title, "CW1", "焦点回相邻标签")
})
