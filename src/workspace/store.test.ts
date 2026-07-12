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
  toggleFileRoot,
  toggleMountedFileRoot,
  setWorkspaceKind,
  setDevelopmentTool,
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
  getWorkspaceKind,
  getDevelopmentTool,
  getActiveModule,
  getActiveRootId,
  getTabs,
  openSettings,
  openAiSettings,
  openAiSection,
  openAiTasks,
  closeFileTabs,
  type ActiveSource,
} from "./store"
import type { NodeRef } from "./node-ref"
import { tabDescriptor } from "./tab-definitions"
import {
  clearResourceSourcesForTest,
  registerResourceSource,
} from "@/filesystem/resource-sources/registry"
import type { ResourceSourceProvider } from "@/filesystem/resource-sources/types"
import { registerBuiltInEngines } from "@/engines/builtin"
import { parseFileEngineTabParams } from "./file-tab"
import { legacyResourceTab } from "./resource-tab"
import { resourceFileTab } from "./resource-file-tab"
import { registerBuiltInFileSystems } from "@/filesystem/builtin"
import { aiTasksPanelFileRef, resourceFileRef } from "@/filesystem/resource-file-system"
import { registerFileSystem } from "@/filesystem/registry"
import { FileSystemError, type FileSystemProvider } from "@/filesystem/types"
import { AUDIO_LIBRARY_ROOT_REF } from "@/filesystem/builtin-app-roots"

registerBuiltInEngines()
registerBuiltInFileSystems()

// —— 标签描述符夹具 (跨五分区导航) ——
const HOME = tabDescriptor("home-overview")
const INFO = tabDescriptor("info")
const COMMUNITY = tabDescriptor("community")
const TOOL = tabDescriptor("tool-search")

test("settings 与 AI 管理入口统一打开 panel 文件", async () => {
  closeAllTabs()

  openSettings()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(parseFileEngineTabParams(getTabs().at(-1)?.params), {
    ref: { fileSystemId: "ideall.core", fileId: "panel:settings" },
    engineId: "ideall.panel",
  })
  assert.equal(getActiveRootId(), "settings")

  openAiSettings()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(parseFileEngineTabParams(getTabs().at(-1)?.params), {
    ref: { fileSystemId: "ideall.core", fileId: "panel:ai-settings" },
    engineId: "ideall.panel-fill",
  })
  assert.equal(getActiveRootId(), "settings")

  openAiSection("ai-mcp")
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(parseFileEngineTabParams(getTabs().at(-1)?.params), {
    ref: { fileSystemId: "ideall.core", fileId: "panel:ai-mcp" },
    engineId: "ideall.panel-fill",
  })
  assert.equal(
    getTabs().some((tab) => tab.kind === "home-settings"),
    false,
  )
  assert.equal(
    getTabs().some((tab) => tab.kind === "ai-settings"),
    false,
  )
  assert.equal(
    getTabs().some((tab) => tab.kind === "ai-mcp"),
    false,
  )

  openAiTasks("ws /100%", "项目任务")
  await new Promise((resolve) => setTimeout(resolve, 0))
  const taskTab = getTabs().at(-1)
  assert.equal(taskTab?.title, "项目任务")
  assert.deepEqual(parseFileEngineTabParams(taskTab?.params), {
    ref: {
      fileSystemId: "ideall.core",
      fileId: "panel:ai-tasks:ws%20%2F100%25",
    },
    engineId: "ideall.panel-fill",
  })
  assert.equal(getActiveRootId(), "activity")
  assert.equal(
    getTabs().some((tab) => tab.kind === "ai-tasks"),
    false,
  )

  const taskRef = aiTasksPanelFileRef("ws /100%")
  openTarget({ type: "file", ref: taskRef, engineId: "ideall.preview", title: "另一种视图" })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(
    getTabs().filter((tab) => parseFileEngineTabParams(tab.params)?.ref.fileId === taskRef.fileId)
      .length,
    2,
  )
  closeFileTabs(taskRef)
  assert.equal(
    getTabs().some((tab) => parseFileEngineTabParams(tab.params)?.ref.fileId === taskRef.fileId),
    false,
  )
})

function openNodeResource(
  ref: NodeRef,
  title: string,
  source: ActiveSource = "user",
  opts?: { transient?: boolean },
) {
  return openTab(resourceFileTab({ scheme: "node", ...ref }, title), source, opts)
}

test("resource file tab 默认来源 user; 传 agent 标记 agent", () => {
  openNodeResource({ kind: "note", id: "u1" }, "用户开")
  assert.equal(getActiveSource(), "user")
  openNodeResource({ kind: "note", id: "a1" }, "AI 开", "agent")
  assert.equal(getActiveSource(), "agent", "agent 经 ui.openTab 自激活 → 来源 agent")
})

test("resourceFileTab: 同步生成统一 file + engine 标签", () => {
  closeAllTabs()
  openTab(resourceFileTab({ scheme: "node", kind: "file", id: "r1" }, "readme.md"), "agent", {
    transient: true,
  })
  const tab = getTabs()[0]
  assert.equal(tab.kind, "file-engine")
  assert.deepEqual(parseFileEngineTabParams(tab.params), {
    ref: { fileSystemId: "ideall.core", fileId: "resource:node%3Afile%3Ar1" },
    engineId: "ideall.preview",
  })
  assert.equal(tab.title, "readme.md")
  assert.equal(tab.rootId, "home")
  assert.ok(tab.path?.startsWith("/home/notes?resource="))
  assert.equal(getTransientId(), tab.id)
  assert.equal(getActiveSource(), "agent")
  openTab(resourceFileTab({ scheme: "tool", kind: "search", id: "default" }))
  const tool = getTabs().at(-1)
  assert.equal(tool?.kind, "file-engine")
  const toolTarget = parseFileEngineTabParams(tool?.params)
  assert.deepEqual(toolTarget?.ref, {
    fileSystemId: "ideall.core",
    fileId: "resource:tool%3Asearch%3Adefault",
  })
  assert.ok(toolTarget?.engineId)
  assert.equal(tool?.rootId, "apps")
})

test("openTab(resource descriptor): 旧模块入口也折叠为 file + engine 标签", () => {
  closeAllTabs()
  openTab(
    legacyResourceTab({ scheme: "browser", kind: "page", id: "https://example.test" }, "例子"),
  )
  const tab = getTabs()[0]
  assert.equal(tab.kind, "file-engine")
  assert.equal(parseFileEngineTabParams(tab.params)?.engineId, "ideall.browser")
  assert.equal(tab.rootId, "browse")
})

test("openTarget(file): resolves descriptor title from resource source metadata", async () => {
  closeAllTabs()
  clearResourceSourcesForTest()
  const provider: ResourceSourceProvider = {
    scheme: "tool",
    async list() {
      return { items: [] }
    },
    async get(ref) {
      return {
        meta: {
          ref,
          title: "Resource Search",
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
  const unregister = registerResourceSource(provider)

  try {
    assert.equal(
      openTarget({
        type: "file",
        ref: resourceFileRef({ scheme: "tool", kind: "search", id: "default" }),
        rootId: "tool",
      }),
      true,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.equal(getTabs().at(-1)?.title, "Resource Search")
  } finally {
    unregister()
    clearResourceSourcesForTest()
  }
})

test("openTarget(file): canonical marker reuses the opened tab's navigation section", () => {
  closeAllTabs()
  openTab({
    ...resourceFileTab({ scheme: "node", kind: "file", id: "rooted" }, "rooted.ts"),
    rootId: "apps",
  })
  const opened = parseFileEngineTabParams(getTabs()[0]?.params)
  assert.ok(opened)
  assert.equal(getActiveRootId(), "apps")

  openTab(HOME)
  assert.equal(getActiveRootId(), "home")
  openTarget({
    type: "file",
    ref: opened.ref,
    engineId: opened.engineId,
    file: {
      ref: opened.ref,
      kind: "file",
      name: "rooted.ts",
      mediaType: "text/plain",
      capabilities: ["read"],
      source: { kind: "local", id: "test" },
    },
  })

  assert.equal(getActiveRootId(), "apps")
  assert.equal(
    getTabs().filter((tab) => {
      const target = parseFileEngineTabParams(tab.params)
      return (
        target?.ref.fileSystemId === opened.ref.fileSystemId &&
        target.ref.fileId === opened.ref.fileId
      )
    }).length,
    1,
  )
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
  for (let i = 1; i <= 12; i++)
    openNodeResource({ kind: "note", id: `cap-${i}` }, String(i), "user")
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

// —— 五分区导航与工作区 Display ——

test("工作区种类正交切换，不改变标签或导航分区", () => {
  closeAllTabs()
  openNodeResource({ kind: "note", id: "workspace-kind" }, "工作区测试")
  setWorkspaceKind("files")
  setDevelopmentTool("git")

  const before = {
    tabs: getTabs().map((tab) => tab.id),
    activeId: getActiveId(),
    activeModule: getActiveModule(),
    activeRootId: getActiveRootId(),
  }

  setWorkspaceKind("audio")
  assert.equal(getWorkspaceKind(), "audio")
  assert.deepEqual(
    {
      tabs: getTabs().map((tab) => tab.id),
      activeId: getActiveId(),
      activeModule: getActiveModule(),
      activeRootId: getActiveRootId(),
    },
    before,
  )

  setWorkspaceKind("development")
  setDevelopmentTool("shell")
  assert.equal(getWorkspaceKind(), "development")
  assert.equal(getDevelopmentTool(), "shell")
  assert.deepEqual(
    getTabs().map((tab) => tab.id),
    before.tabs,
  )

  setDevelopmentTool("git")
  setWorkspaceKind("files")
})

test("切换工作区为当前 FileRef 激活场景 Engine，并保留原 Engine 标签", async () => {
  closeAllTabs()
  setWorkspaceKind("files")
  const ref = { fileSystemId: "test.workspace-scenario", fileId: "readme" }
  const file = {
    ref,
    kind: "file" as const,
    name: "readme.txt",
    mediaType: "text/plain",
    capabilities: ["read" as const],
    source: { kind: "local" as const, id: "test" },
  }
  const provider: FileSystemProvider = {
    descriptor: {
      fileSystemId: ref.fileSystemId,
      name: "Workspace scenario fixture",
      root: { fileSystemId: ref.fileSystemId, fileId: "root" },
      source: file.source,
    },
    async stat(target) {
      return target.fileId === ref.fileId ? file : null
    },
    async readDirectory() {
      return { entries: [] }
    },
    async read(target) {
      throw new FileSystemError("unsupported", "fixture has no content", target)
    },
    async write(target) {
      throw new FileSystemError("unsupported", "fixture is read-only", target)
    },
    async actions() {
      return []
    },
    async invoke(target) {
      throw new FileSystemError("unsupported", "fixture has no actions", target)
    },
  }
  const unregister = registerFileSystem(provider)
  try {
    openTarget({ type: "file", ref, file, transient: true })
    assert.equal(parseFileEngineTabParams(getTabs().at(-1)?.params)?.engineId, "ideall.preview")
    const previewId = getActiveId()
    assert.equal(getTransientId(), previewId)

    setWorkspaceKind("development")
    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.equal(parseFileEngineTabParams(getTabs().at(-1)?.params)?.engineId, "ideall.code")
    assert.ok(
      getTabs().some((tab) => tab.id === previewId),
      "场景切换不能替换活动预览标签",
    )
    assert.equal(getTransientId(), previewId, "原预览槽保留，新场景标签按显式导航打开")
    assert.deepEqual(
      getTabs()
        .map((tab) => parseFileEngineTabParams(tab.params))
        .filter((target) => target?.ref.fileSystemId === ref.fileSystemId)
        .map((target) => target?.engineId)
        .sort(),
      ["ideall.code", "ideall.preview"],
    )
  } finally {
    setWorkspaceKind("files")
    await new Promise((resolve) => setTimeout(resolve, 0))
    closeAllTabs()
    unregister()
  }
})

test("同步导航或后发文件打开都会取消旧的慢 stat，避免抢回焦点", async () => {
  closeAllTabs()
  setWorkspaceKind("files")
  let releaseSlow: (() => void) | undefined
  const slowGate = new Promise<void>((resolve) => {
    releaseSlow = resolve
  })
  const fileFor = (fileId: string) => ({
    ref: { fileSystemId: "test.workspace-race", fileId },
    kind: "file" as const,
    name: `${fileId}.txt`,
    mediaType: "text/plain",
    capabilities: ["read" as const],
    source: { kind: "local" as const, id: "test" },
  })
  const provider: FileSystemProvider = {
    descriptor: {
      fileSystemId: "test.workspace-race",
      name: "Workspace race fixture",
      root: { fileSystemId: "test.workspace-race", fileId: "root" },
      source: { kind: "local", id: "test" },
    },
    async stat(ref) {
      if (ref.fileId === "slow") await slowGate
      return ref.fileId === "slow" || ref.fileId === "fast" ? fileFor(ref.fileId) : null
    },
    async readDirectory() {
      return { entries: [] }
    },
    async read(ref) {
      throw new FileSystemError("unsupported", "fixture has no content", ref)
    },
    async write(ref) {
      throw new FileSystemError("unsupported", "fixture is read-only", ref)
    },
    async actions() {
      return []
    },
    async invoke(ref) {
      throw new FileSystemError("unsupported", "fixture has no actions", ref)
    },
  }
  const baseStat = provider.stat.bind(provider)
  const unregister = registerFileSystem(provider)
  try {
    openTarget({ type: "file", ref: fileFor("slow").ref })
    setWorkspaceKind("development")
    releaseSlow?.()
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(
      getTabs().some((tab) => parseFileEngineTabParams(tab.params)?.ref.fileId === "slow"),
      false,
      "工作区切换取消此前的慢文件请求",
    )

    closeAllTabs()
    setWorkspaceKind("files")
    openTarget({ type: "file", ref: fileFor("fast").ref })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const fastId = getActiveId()!
    let releaseActivation: (() => void) | undefined
    const activationGate = new Promise<void>((resolve) => {
      releaseActivation = resolve
    })
    provider.stat = async (ref, ctx) => {
      if (ref.fileId === "slow") await activationGate
      return baseStat(ref, ctx)
    }
    openTarget({ type: "file", ref: fileFor("slow").ref })
    setActiveTab(fastId)
    releaseActivation?.()
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(getActiveId(), fastId)
    assert.equal(
      getTabs().some((tab) => parseFileEngineTabParams(tab.params)?.ref.fileId === "slow"),
      false,
      "显式激活已有标签取消慢文件请求",
    )

    let releaseOlder: (() => void) | undefined
    const olderGate = new Promise<void>((resolve) => {
      releaseOlder = resolve
    })
    provider.stat = async (ref, ctx) => {
      if (ref.fileId === "slow") await olderGate
      return baseStat(ref, ctx)
    }
    openTarget({ type: "file", ref: fileFor("slow").ref })
    openTarget({ type: "file", ref: fileFor("fast").ref })
    await new Promise((resolve) => setTimeout(resolve, 0))
    releaseOlder?.()
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(parseFileEngineTabParams(getTabs().at(-1)?.params)?.ref.fileId, "fast")
    assert.equal(
      getTabs().some((tab) => parseFileEngineTabParams(tab.params)?.ref.fileId === "slow"),
      false,
    )
  } finally {
    releaseSlow?.()
    setWorkspaceKind("files")
    await new Promise((resolve) => setTimeout(resolve, 0))
    closeAllTabs()
    unregister()
  }
})

test("openTab / setActiveTab 让导航分区随标签 root 更新", () => {
  closeAllTabs()
  openTab(HOME)
  const homeId = getActiveId()!
  assert.equal(getActiveRootId(), "home")
  assert.equal(getActiveModule(), "home")

  openTab(COMMUNITY)
  const communityId = getActiveId()!
  assert.equal(getActiveRootId(), "browse")
  assert.equal(getActiveModule(), "community")

  openTab(TOOL)
  assert.equal(getActiveRootId(), "apps")
  assert.equal(getActiveModule(), "tool")

  setActiveTab(homeId)
  assert.equal(getActiveRootId(), "home")
  assert.equal(getActiveModule(), "home")
  setActiveTab(communityId)
  assert.equal(getActiveRootId(), "browse")
  assert.equal(getActiveModule(), "community")
})

test("toggleModule 把旧模块入口归入对应导航分区", () => {
  closeAllTabs()
  toggleModule("community")
  assert.equal(getActiveRootId(), "browse")
  assert.equal(getActiveModule(), "community")
  toggleModule("home")
  assert.equal(getActiveRootId(), "home")
  assert.equal(getActiveModule(), "home")
  toggleModule("tool")
  assert.equal(getActiveRootId(), "apps")
  assert.equal(getActiveModule(), "tool")
})

test("toggleFileRoot 可直接选择五个固定导航分区", async () => {
  closeAllTabs()
  const sections = [
    ["home", "home"],
    ["activity", "agent"],
    ["browse", "info"],
    ["apps", "apps"],
    ["settings", "home"],
  ] as const
  for (const [rootId, moduleId] of sections) {
    toggleFileRoot(rootId)
    assert.equal(getActiveRootId(), rootId)
    assert.equal(getActiveModule(), moduleId)
  }
  await new Promise((resolve) => setTimeout(resolve, 0))
})

test("toggleMountedFileRoot opens a mounted app's real root through its semantic engine", async () => {
  closeAllTabs()
  toggleFileRoot("home")
  const provider: FileSystemProvider = {
    descriptor: {
      fileSystemId: AUDIO_LIBRARY_ROOT_REF.fileSystemId,
      name: "Audio root fixture",
      root: AUDIO_LIBRARY_ROOT_REF,
      source: { kind: "app", id: "audio" },
    },
    async stat(ref) {
      return ref.fileId === AUDIO_LIBRARY_ROOT_REF.fileId
        ? {
            ref,
            kind: "directory",
            name: "音频库",
            mediaType: "application/vnd.ideall.audio.library+json",
            capabilities: ["read-directory", "read"],
            source: { kind: "app", id: "audio" },
          }
        : null
    },
    async readDirectory() {
      return { entries: [] }
    },
    async read(ref) {
      throw new FileSystemError("unsupported", "fixture has no content", ref)
    },
    async write(ref) {
      throw new FileSystemError("unsupported", "fixture is read-only", ref)
    },
    async actions() {
      return []
    },
    async invoke(ref) {
      throw new FileSystemError("unsupported", "fixture has no actions", ref)
    },
  }
  const unregister = registerFileSystem(provider)
  try {
    toggleMountedFileRoot(AUDIO_LIBRARY_ROOT_REF)
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.deepEqual(parseFileEngineTabParams(getTabs().at(-1)?.params), {
      ref: AUDIO_LIBRARY_ROOT_REF,
      engineId: "ideall.audio",
    })
    assert.equal(getActiveRootId(), "apps")
    assert.equal(getActiveModule(), "audio")
  } finally {
    closeAllTabs()
    unregister()
  }
})

test("closeTab: 焦点转移时导航分区随下一个标签 root 更新", () => {
  closeAllTabs()
  openTab(HOME)
  openTab(INFO)
  const infoId = getActiveId()!
  openTab(TOOL)
  const toolId = getActiveId()!

  setActiveTab(infoId)
  assert.equal(getActiveRootId(), "browse")
  closeTab(infoId)
  assert.equal(getActiveId(), toolId)
  assert.equal(getActiveRootId(), "apps")
  assert.equal(getActiveModule(), "tool")

  closeTab(toolId)
  const active = getTabs().find((t) => t.id === getActiveId())
  assert.deepEqual(parseFileEngineTabParams(active?.params), {
    ref: { fileSystemId: "ideall.core", fileId: "panel:home" },
    engineId: "ideall.panel",
  })
  assert.equal(getActiveRootId(), "home")
  assert.equal(getActiveModule(), "home")
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
