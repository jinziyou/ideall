"use client"

// 工作区状态 (多标签 + 活动模块 + 二级侧栏折叠)。
// RTK slice (DevTools) + 薄 imperative facade (openTab / getActiveId 等端口不变)。
// 标签 keep-alive: tab-host 对激活 + 最近的重标签 (iframe/编辑器) 做 LRU 保持后台运行、非激活态 display:none
// (不重载); 超出上限的重标签被卸载 (草稿由写队列落盘)。轻标签全挂载。详见 tab-host.tsx。

import type { ModuleId, Tab, TabDescriptor, WsMode } from "./types"
import { nodeTab, parseNodeParams } from "./node-tab"
import type { NodeRef } from "./node-ref"
import {
  descriptorForResource,
  descriptorForResourceMeta,
  type OpenTarget,
} from "./open-target"
import { getResource } from "@/vfs/registry"
import { coerceActiveModuleForMode, moduleById, isModeNeutralModule } from "./modules"
import { tabDescriptor } from "./tab-definitions"
import { isTauri, browserRelease } from "@/lib/tauri"
import { store, useAppSelector } from "@/lib/store"
import { workspaceActions, type ActiveSource, type WorkspaceState } from "./workspace-slice"
import { WORKSPACE_STORAGE_KEY } from "./workspace-persist"
import { setActiveWorkspace } from "@/plugins/agent/lib/agent-workspace"
import { requestEmbedRoute } from "@/plugins/embed/embed-nav"

export type { ActiveSource }
export type { OpenTarget }

function ws(): WorkspaceState {
  return store.getState().workspace
}

function setState(patch: Partial<WorkspaceState>) {
  store.dispatch(workspaceActions.patch(patch))
}

function dirtySet(): Set<string> {
  return new Set(ws().dirtyTabs)
}

/** 模块 → 工作区模式视图 (本地 / 连接)。仅在「显式模块导航」(活动栏 toggleModule) 时据此同步视图;
 *  打开/激活/关闭标签一律不翻 mode —— 否则点一个另一模式的标签会整排重构活动栏, 摧毁空间锚点
 *  (视图切换只归 ModeSwitch 与活动栏图标两个显式入口)。 */
const MODE_OF: Record<ModuleId, WsMode> = {
  home: "local",
  subscriptions: "local",
  apps: "local",
  plugins: "local",
  shell: "local",
  git: "local",
  database: "local",
  audio: "local",
  code: "local",
  trash: "local",
  tool: "connected",
  info: "connected",
  community: "connected",
  publications: "connected",
  browser: "connected",
  agent: "connected",
}

/** 全部合法模块 id (水合时据此清洗陈旧/污染标签: module 不在此集合的丢弃)。
 *  用 Record<ModuleId,...> 构造 → 将来 ModuleId 增删而漏更新此处时编译期即报错 (而非静默丢标签)。 */
const VALID_MODULES = new Set(
  Object.keys({
    home: 1,
    subscriptions: 1,
    apps: 1,
    plugins: 1,
    shell: 1,
    git: 1,
    database: 1,
    audio: 1,
    code: 1,
    trash: 1,
    info: 1,
    community: 1,
    publications: 1,
    browser: 1,
    tool: 1,
    agent: 1,
  } satisfies Record<ModuleId, 1>) as ModuleId[],
)

function validModule(value: unknown): ModuleId | null {
  return typeof value === "string" && VALID_MODULES.has(value as ModuleId)
    ? (value as ModuleId)
    : null
}

function validMode(value: unknown): WsMode {
  return value === "connected" || value === "local" ? value : "local"
}

type OpenTabOpts = { transient?: boolean }

/** 标签去重 key: 同 kind(+params) 视为同一标签。
 *  params 按键排序后序列化, 避免顺序差异 (如 {a,b} vs {b,a}) 造成同一标签开成两个实例。 */
export function tabKey(d: TabDescriptor): string {
  if (!d.params) return d.kind
  const sorted = Object.keys(d.params)
    .sort()
    .map((k) => `${k}=${d.params![k]}`)
    .join("&")
  return `${d.kind}:${sorted}`
}

function persist() {
  /* 持久化由 lib/store workspacePersistMiddleware 处理 (patch/hydrate 后触发)。 */
}

/** 客户端挂载后调用一次: 从本地存储恢复上次的标签 (sessionStorage 优先 = 本浏览器标签的会话现场;
 *  兜底 localStorage = 跨重启的最近一次快照, 桌面 App 重启 / 浏览器重开靠它恢复工作现场;
 *  新浏览器标签无 session 时会继承 localStorage 快照 —— 有意为之, 非 per-tab 隔离)。
 *  与路由标记的 openTab 顺序无关 (React 不保证父子 effect 顺序): 采用合并而非覆盖 ——
 *  历史标签在前, 本次会话已开的标签去重并入; 当前路由已设的激活标签优先。 */
export function hydrateWorkspace() {
  if (ws().hydrated || typeof window === "undefined") return
  let saved: {
    tabs: Tab[]
    activeId: string | null
    transientId: string | null
    activeModule: ModuleId
    mode: WsMode
    sidebarCollapsed: boolean
    rightPanelOpen: boolean
  } | null = null
  try {
    const raw =
      sessionStorage.getItem(WORKSPACE_STORAGE_KEY) ?? localStorage.getItem(WORKSPACE_STORAGE_KEY)
    if (raw) {
      const p = JSON.parse(raw) as {
        tabs?: Tab[]
        activeId?: string | null
        transientId?: string | null
        activeModule?: ModuleId
        mode?: WsMode
        sidebarCollapsed?: boolean
        rightPanelOpen?: boolean
      }
      if (Array.isArray(p.tabs)) {
        saved = {
          tabs: p.tabs,
          activeId: p.activeId ?? null,
          transientId: p.transientId ?? null,
          activeModule: validModule(p.activeModule) ?? "home",
          mode: validMode(p.mode),
          sidebarCollapsed: p.sidebarCollapsed ?? false,
          rightPanelOpen: p.rightPanelOpen ?? false,
        }
      }
    }
  } catch {
    /* 损坏数据 → 忽略 */
  }
  if (saved) {
    const cur = ws()
    // 清洗: 丢弃 module 不在合法集合的污染/陈旧标签 (防下线某模块留僵尸标签);
    // 节点标签额外要求 params 能解析出合法 NodeRef (防下线某 kind / 损坏 params 留僵尸标签)。
    const validTabs = saved.tabs.filter(
      (t) =>
        VALID_MODULES.has(t.module) && (t.kind === "node" ? !!parseNodeParams(t.params) : true),
    )
    const merged = [...validTabs]
    for (const t of cur.tabs) if (!merged.some((x) => x.id === t.id)) merged.push(t)
    const wantId = cur.activeId ?? saved.activeId
    const activeTab = wantId ? (merged.find((x) => x.id === wantId) ?? null) : null
    const aiActive = activeTab?.module === "agent"
    store.dispatch(
      workspaceActions.hydrate({
        tabs: merged,
        activeId: activeTab ? activeTab.id : null,
        transientId:
          saved.transientId && merged.some((t) => t.id === saved.transientId)
            ? saved.transientId
            : null,
        lru: activeTab ? [activeTab.id] : [],
        activeSource: "user",
        activeModule: aiActive
          ? saved.activeModule
          : activeTab
            ? coerceActiveModuleForMode(activeTab.module, saved.mode, saved.activeModule)
            : cur.activeId
              ? coerceActiveModuleForMode(cur.activeModule, saved.mode, saved.activeModule)
              : coerceActiveModuleForMode(saved.activeModule, saved.mode),
        mode: saved.mode,
        sidebarCollapsed: saved.sidebarCollapsed,
        rightPanelOpen: saved.rightPanelOpen,
      }),
    )
  } else {
    store.dispatch(workspaceActions.hydrate({}))
  }
  if (isTauri()) {
    const { tabs, activeId } = store.getState().workspace
    const active = tabs.find((t) => t.id === activeId)
    if (active?.kind !== "browser-view") void browserRelease().catch(() => {})
  }
}

// —— 动作 ——

/** 切离「浏览器」标签时收起原生子 webview, 避免其叠在插件 iframe 上拦截点击。 */
function hideBrowserWebviewUnlessBrowserTab(kind: string) {
  if (kind === "browser-view") return
  if (isTauri()) void browserRelease().catch(() => {})
}

/** 计算「以瞬态(预览)方式打开 d」后的 tabs/transientId/activeId 补丁: 复用单一预览槽。
 *  - 该标签已存在: 仅激活, 不改其常驻/瞬态性 (单击一个已开标签不应把它降级成预览)。
 *  - 不存在且当前有预览槽: 原地替换旧预览 (位置不变, 旧预览内容由 tab-host 卸载)。
 *  - 不存在且无预览槽: 追加为新的预览标签。 */
function transientOpenPatch(d: TabDescriptor): {
  tabs: Tab[]
  transientId: string | null
  activeId: string
} {
  const id = tabKey(d)
  if (ws().tabs.some((t) => t.id === id)) {
    return { tabs: ws().tabs, transientId: ws().transientId, activeId: id }
  }
  if (ws().transientId && ws().tabs.some((t) => t.id === ws().transientId)) {
    return {
      tabs: ws().tabs.map((t) => (t.id === ws().transientId ? { ...d, id } : t)),
      transientId: id,
      activeId: id,
    }
  }
  return { tabs: [...ws().tabs, { ...d, id }], transientId: id, activeId: id }
}

/** 常驻标签软上限: 超过即回收最久未用的冷标签 (预览标签是单槽, 不计入)。 */
const MAX_PERMANENT_TABS = 12

/** 若常驻标签数超过软上限, 按 LRU 关闭最久未访问、非 protect、非预览的常驻标签, 直到回到上限。
 *  未保存草稿由写队列在卸载时落库 (与 tab-host 内容逐出同理), 故关闭是数据安全的。
 *  在 setState 之前调用 → 读 ws().lru / ws().transientId 的当前快照。 */
function evictColdTabs(tabs: Tab[], protect: Set<string>): Tab[] {
  const transient = ws().transientId
  const dirty = dirtySet()
  const permanentCount = tabs.reduce((n, t) => (t.id === transient ? n : n + 1), 0)
  const overflow = permanentCount - MAX_PERMANENT_TABS
  if (overflow <= 0) return tabs
  const rank = new Map(ws().lru.map((id, i) => [id, i])) // 越小越久未用
  const evictable = tabs
    .filter((t) => t.id !== transient && !protect.has(t.id) && !dirty.has(t.id))
    .sort((a, b) => (rank.get(a.id) ?? -1) - (rank.get(b.id) ?? -1))
    .slice(0, overflow)
  if (evictable.length === 0) return tabs
  const drop = new Set(evictable.map((t) => t.id))
  return tabs.filter((t) => !drop.has(t.id))
}

/** 打开 (或激活已存在的) 标签, 并把活动模块同步到该标签所属模块 (驱动活动栏高亮 / 侧栏)。
 *  不翻 mode 视图 (打开标签是内容导航, 不是视图切换; 见 MODE_OF 注释)。
 *  source 默认 user (UI/路由触发); agent 经 ui.openTab 打开时传 "agent" —— 仅影响隐式同意, 不改打开行为。
 *  opts.transient=true → 预览标签 (复用单一预览槽: 轻底/淡色点/标题点线下划线); 缺省 = 常驻打开
 *  (若命中当前预览槽则提升为常驻)。新增常驻标签超过软上限时自动回收最久未用的冷标签。 */
export function openTab(d: TabDescriptor, source: ActiveSource = "user", opts?: OpenTabOpts) {
  hideBrowserWebviewUnlessBrowserTab(d.kind)
  const id = tabKey(d)
  if (opts?.transient) {
    setState({
      ...transientOpenPatch(d),
      activeModule: coerceActiveModuleForMode(d.module, ws().mode, ws().activeModule),
      activeSource: source,
    })
    return
  }
  const exists = ws().tabs.some((t) => t.id === id)
  const tabs = exists ? ws().tabs : evictColdTabs([...ws().tabs, { ...d, id }], new Set([id]))
  setState({
    tabs,
    // 显式 (非瞬态) 打开命中当前预览槽 → 提升为常驻。
    transientId: ws().transientId === id ? null : ws().transientId,
    activeId: id,
    activeModule: coerceActiveModuleForMode(d.module, ws().mode, ws().activeModule),
    activeSource: source,
  })
}

/** 把预览标签提升为常驻 (双击标签条/侧栏行调用); 非当前预览标签则忽略。 */
export function promoteTab(id: string) {
  if (ws().transientId !== id) return
  setState({ transientId: null })
}

/** 若当前激活标签正是预览标签, 提升为常驻 (供「编辑即固定」: 内容编辑器首次编辑时调用, 避免改到一半被下次预览替换)。 */
export function promoteActiveTab() {
  if (ws().activeId && ws().activeId === ws().transientId) {
    setState({ transientId: null })
  }
}

/** 打开全局设置标签 (外观 / 本机 / 已连接应用)。 */
const SETTINGS_TAB = tabDescriptor("home-settings")

export function openSettings() {
  openTab(SETTINGS_TAB)
}

/** AI 全局设置标签 (默认 AI 标签; module:"agent")。 */
const AI_SETTINGS_TAB = tabDescriptor("ai-settings")

/** 打开/激活一个 AI 区段标签: 设 activeModule=agent + 展开 AI 二级侧栏。
 *  opts.transient → 走单一预览槽 (与 openTab 同语义)。 */
function openAgentTab(d: TabDescriptor, opts?: OpenTabOpts) {
  if (opts?.transient) {
    setState({
      ...transientOpenPatch(d),
      activeModule: "agent",
      sidebarCollapsed: false,
      activeSource: "user",
    })
    return
  }
  const id = tabKey(d)
  const exists = ws().tabs.some((t) => t.id === id)
  const tabs = exists ? ws().tabs : evictColdTabs([...ws().tabs, { ...d, id }], new Set([id]))
  setState({
    tabs,
    transientId: ws().transientId === id ? null : ws().transientId,
    activeId: id,
    activeModule: "agent",
    sidebarCollapsed: false,
    activeSource: "user",
  })
}

/** AI 管理标签 = 全局 AI 设置 (次级入口: 右栏齿轮 / /ai 深链 / ui-actions 端口)。
 *  AI 主入口是对话: 顶栏 AI 钮与移动中央 AI 钮均呼出右侧对话栏 (toggleRightPanel / setRightPanel)。 */
export function openAiSettings(opts?: OpenTabOpts) {
  openAgentTab(AI_SETTINGS_TAB, opts)
}

/** 打开 AI 区段管理标签 (MCP / Skills / 规则)。 */
export function openAiSection(kind: "ai-mcp" | "ai-skills" | "ai-rules", opts?: OpenTabOpts) {
  openAgentTab(tabDescriptor(kind), opts)
}

/** 打开某工作区的任务标签 (params.workspaceId 区分实例; 不设 path → 不参与 URL 同步)。 */
export function openAiTasks(workspaceId: string, title: string, opts?: OpenTabOpts) {
  setActiveWorkspace(workspaceId)
  openAgentTab(tabDescriptor("ai-tasks", { title, params: { workspaceId } }), opts)
}

function updateTabDescriptor(d: TabDescriptor) {
  const id = tabKey(d)
  if (!ws().tabs.some((t) => t.id === id)) return
  setState({ tabs: ws().tabs.map((t) => (t.id === id ? { ...t, ...d, id } : t)) })
}

function requestConnectedEmbedRoute(meta: { ref: OpenTargetResourceRef; route?: string }) {
  const { ref, route } = meta
  if (!route || (ref.scheme !== "info" && ref.scheme !== "community")) return
  requestEmbedRoute(ref.scheme, route)
}

type OpenTargetResourceRef = Extract<OpenTarget, { type: "resource" }>["ref"]

async function refreshResourceTarget(target: Extract<OpenTarget, { type: "resource" }>) {
  try {
    const meta =
      target.meta ??
      (
        await getResource(target.ref, {
          actor: "ui",
          permissions: [],
          intent: "metadata",
        })
      )?.meta
    if (!meta) return
    const descriptor = descriptorForResourceMeta(meta)
    if (descriptor) updateTabDescriptor(descriptor)
    requestConnectedEmbedRoute(meta)
  } catch {
    /* fallback descriptor already opened */
  }
}

/** 统一打开入口: ResourceRef 通过 VFS meta 归一到标签描述; 同步 fallback 保持打开手感。 */
export function openTarget(target: OpenTarget, source: ActiveSource = "user"): boolean {
  switch (target.type) {
    case "tab":
      openTab(target.descriptor, source, { transient: target.transient })
      return true
    case "resource": {
      const descriptor = target.meta
        ? descriptorForResourceMeta(target.meta)
        : descriptorForResource(target.ref, target.title)
      if (!descriptor) return false
      openTab(descriptor, source, { transient: target.transient })
      void refreshResourceTarget(target)
      return true
    }
    case "command":
      if (target.command === "open-ai-panel") setRightPanel(true)
      else toggleRightPanel()
      return true
  }
}

/** 打开 (或激活已存在的) 一个节点标签。三入口 (搜索/侧栏/AI) 统一经此, 保证 entity 级去重。
 *  AI (boot.ts 的 ui.openTab) 传 source="agent" —— 该节点不计入「打开即隐式同意」(隐私)。 */
export function openNodeTab(
  ref: NodeRef,
  title: string,
  source: ActiveSource = "user",
  opts?: OpenTabOpts,
) {
  openTarget(
    { type: "resource", ref: { scheme: "node", ...ref }, title, transient: opts?.transient },
    source,
  )
}

/** 节点标签取数后回填真实标题 (不改 id / 去重 key, 仅更新显示)。 */
export function renameNodeTab(ref: NodeRef, title: string) {
  const id = tabKey(nodeTab(ref, title))
  if (!ws().tabs.some((t) => t.id === id)) return
  setState({ tabs: ws().tabs.map((t) => (t.id === id ? { ...t, title } : t)) })
}

/** 标记标签存在未保存草稿。dirty 标签不会被自动回收; UI 关闭前会二次确认。 */
export function setTabDirty(id: string, dirty: boolean) {
  if (!ws().tabs.some((t) => t.id === id)) return
  const next = dirtySet()
  if (dirty) next.add(id)
  else next.delete(id)
  const dirtyTabs = [...next]
  if (
    dirtyTabs.length === ws().dirtyTabs.length &&
    dirtyTabs.every((x, i) => x === ws().dirtyTabs[i])
  )
    return
  setState({ dirtyTabs })
}

export function isTabDirty(id: string): boolean {
  return ws().dirtyTabs.includes(id)
}

export type DirtyTabCloseRequest = {
  title: string
  description: string
  confirmLabel: string
  ids: string[]
  confirm: () => void
}

const dirtyTabCloseListeners = new Set<(request: DirtyTabCloseRequest) => void>()

export function subscribeDirtyTabCloseRequests(
  listener: (request: DirtyTabCloseRequest) => void,
): () => void {
  dirtyTabCloseListeners.add(listener)
  return () => {
    dirtyTabCloseListeners.delete(listener)
  }
}

function dirtyCloseRequest(ids: string[], confirm: () => void): DirtyTabCloseRequest | null {
  const dirtyIds = ids.filter((id) => ws().dirtyTabs.includes(id))
  if (dirtyIds.length === 0) return null
  const dirtyTabs = ws().tabs.filter((t) => dirtyIds.includes(t.id))
  const names = dirtyTabs
    .slice(0, 3)
    .map((t) => `「${t.title || "未命名"}」`)
    .join("、")
  const extra = dirtyTabs.length > 3 ? `等 ${dirtyTabs.length} 个标签` : ""
  return {
    ids: dirtyIds,
    title: "关闭未保存的标签？",
    description: `${names}${extra} 有未保存更改，关闭后会丢失这些更改。`,
    confirmLabel: "关闭标签",
    confirm,
  }
}

function requestDirtyClose(ids: string[], confirm: () => void): boolean {
  const request = dirtyCloseRequest(ids, confirm)
  if (!request) return true
  for (const listener of dirtyTabCloseListeners) listener(request)
  return false
}

/** 关闭标签; 若关的是激活项, 焦点转移到相邻标签。 */
export function closeTab(id: string) {
  const idx = ws().tabs.findIndex((t) => t.id === id)
  if (idx === -1) return
  const closingKind = ws().tabs[idx]?.kind
  const tabs = ws().tabs.filter((t) => t.id !== id)
  if (closingKind === "browser-view" && isTauri()) {
    void browserRelease().catch(() => {})
  }
  let activeId = ws().activeId
  let activeModule = ws().activeModule
  if (ws().activeId === id) {
    const next = tabs[idx] ?? tabs[idx - 1] ?? null
    activeId = next ? next.id : null
    // 焦点转移到相邻标签时同步活动模块 (否则活动栏/侧栏会停在旧模块); mode 不随标签翻转。
    if (next) {
      hideBrowserWebviewUnlessBrowserTab(next.kind)
      activeModule = coerceActiveModuleForMode(next.module, ws().mode, activeModule)
    }
  }
  setState({
    tabs,
    activeId,
    activeModule,
    transientId: ws().transientId === id ? null : ws().transientId,
    activeSource: "user",
  })
}

/** UI 关闭标签入口: dirty 标签先确认; 返回是否真的关闭。 */
export function requestCloseTab(id: string): boolean {
  if (!requestDirtyClose([id], () => closeTab(id))) return false
  closeTab(id)
  return true
}

/** 关闭全部标签。 */
export function closeAllTabs() {
  if (ws().tabs.length === 0) return
  if (isTauri()) void browserRelease().catch(() => {})
  setState({
    tabs: [],
    activeId: null,
    transientId: null,
    activeSource: "user",
  })
}

export function requestCloseAllTabs(): boolean {
  if (
    !requestDirtyClose(
      ws().tabs.map((t) => t.id),
      closeAllTabs,
    )
  )
    return false
  closeAllTabs()
  return true
}

/** 关闭除 keepId 外的全部标签。 */
export function closeOtherTabs(keepId: string) {
  const keep = ws().tabs.find((t) => t.id === keepId)
  if (!keep) return
  hideBrowserWebviewUnlessBrowserTab(keep.kind)
  setState({
    tabs: [keep],
    activeId: keepId,
    activeModule: coerceActiveModuleForMode(keep.module, ws().mode, ws().activeModule),
    transientId: ws().transientId === keepId ? keepId : null,
    activeSource: "user",
  })
}

export function requestCloseOtherTabs(keepId: string): boolean {
  if (
    !requestDirtyClose(
      ws()
        .tabs.filter((t) => t.id !== keepId)
        .map((t) => t.id),
      () => closeOtherTabs(keepId),
    )
  )
    return false
  closeOtherTabs(keepId)
  return true
}

export function setActiveTab(id: string) {
  const t = ws().tabs.find((x) => x.id === id)
  if (!t) return
  hideBrowserWebviewUnlessBrowserTab(t.kind)
  // 激活标签不翻 mode 视图; activeModule 只作为左侧导航/侧栏锚点, 需收束在当前 mode 可见范围内。
  // 用户主动点标签 = 用户在看它 → 来源 user (即便它原是 agent 经 ui.openTab 开的, 用户点回即视作同意)。
  setState({
    activeId: id,
    activeModule: coerceActiveModuleForMode(t.module, ws().mode, ws().activeModule),
    activeSource: "user",
  })
}

/** 点活动栏图标: 同模块且侧栏展开 → 收起侧栏; 否则切到该模块、展开侧栏, 并以「预览」方式开其首个面板。 */
export function toggleModule(m: ModuleId) {
  if (ws().activeModule === m && !ws().sidebarCollapsed) {
    setState({ sidebarCollapsed: true })
    return
  }
  const mod = moduleById(m)
  const first = mod.entries[0]
  // mode-中性模块 (跨模式工具): 切到它不翻视图; 否则同步到该模块所属模式。
  const mode = isModeNeutralModule(m) ? ws().mode : MODE_OF[m]
  if (!first || m === "plugins") {
    setState({ activeModule: m, mode, sidebarCollapsed: false })
    return
  }
  hideBrowserWebviewUnlessBrowserTab(first.descriptor.kind)
  // 切模块进来的落地面板用「预览」方式开: 点遍多个模块只复用单一预览槽, 不再每切一个就堆一个常驻标签。
  setState({
    ...transientOpenPatch(first.descriptor),
    activeModule: m,
    mode,
    sidebarCollapsed: false,
    activeSource: "user",
  })
}

/** 切换工作区模式视图 (本地 / 连接): 活动模块归到该模式首个模块, 展开侧栏并以预览方式开其落地面板。
 *  已是该模式则无操作 (点已激活的分段不打扰当前标签)。 */
export function setMode(mode: WsMode) {
  if (mode === ws().mode) {
    const activeModule = coerceActiveModuleForMode(ws().activeModule, mode)
    if (activeModule !== ws().activeModule) setState({ activeModule })
    return
  }
  const firstModule: ModuleId = mode === "local" ? "home" : "info"
  const mod = moduleById(firstModule)
  const first = mod.entries[0]
  if (!first) {
    setState({ mode, activeModule: firstModule, sidebarCollapsed: false, activeSource: "user" })
    return
  }
  hideBrowserWebviewUnlessBrowserTab(first.descriptor.kind)
  setState({
    ...transientOpenPatch(first.descriptor),
    mode,
    activeModule: firstModule,
    sidebarCollapsed: false,
    activeSource: "user",
  })
}

export function setSidebarCollapsed(v: boolean) {
  setState({ sidebarCollapsed: v })
}

/** 切换左侧二级侧栏显隐 (顶栏布局开关)。 */
export function toggleSidebar() {
  setState({ sidebarCollapsed: !ws().sidebarCollapsed })
}

/** 切换 AI 工作区侧栏 (活动栏「工作区」钮): 展开 agent 模块树 (MCP / Skills / 工作区任务等)。 */
export function toggleWorkspace() {
  if (ws().activeModule === "agent" && !ws().sidebarCollapsed) {
    setState({ sidebarCollapsed: true })
    return
  }
  setState({
    activeModule: "agent",
    sidebarCollapsed: false,
    activeSource: "user",
  })
}

/** 右侧 AI 对话栏开关 (顶栏 AI 钮 / 移动底栏中央 AI 钮)。 */
export function toggleRightPanel() {
  setState({ rightPanelOpen: !ws().rightPanelOpen })
}
export function setRightPanel(v: boolean) {
  setState({ rightPanelOpen: v })
}

/** 拖拽重排: 把 fromId 移动到 toId 的位置。 */
export function reorderTabs(fromId: string, toId: string) {
  const from = ws().tabs.findIndex((t) => t.id === fromId)
  const to = ws().tabs.findIndex((t) => t.id === toId)
  if (from === -1 || to === -1 || from === to) return
  const tabs = [...ws().tabs]
  const [moved] = tabs.splice(from, 1)
  tabs.splice(to, 0, moved)
  setState({ tabs })
}

// —— 键盘导航动作 (全局快捷键 / 命令面板共用) ——

/** 关闭当前激活标签 (mod+W)。无激活标签时无操作。 */
export function closeActiveTab() {
  const id = ws().activeId
  if (id) closeTab(id)
}

export function requestCloseActiveTab(): boolean {
  const id = ws().activeId
  if (!id) return true
  return requestCloseTab(id)
}

/** 按标签条顺序激活相邻标签 (Ctrl+Tab / Ctrl+PgUp/PgDn), 首尾循环。 */
export function activateAdjacentTab(delta: 1 | -1) {
  const n = ws().tabs.length
  if (n === 0) return
  const cur = ws().tabs.findIndex((t) => t.id === ws().activeId)
  const next = ws().tabs[(cur === -1 ? 0 : cur + delta + n) % n]
  setActiveTab(next.id)
}

/** 激活第 N 个标签 (mod+1..9; 浏览器惯例: 9 = 最后一个)。 */
export function activateTabAt(index: number) {
  const n = ws().tabs.length
  if (n === 0 || index < 1) return
  const t = index >= 9 ? ws().tabs[n - 1] : ws().tabs[index - 1]
  if (t) setActiveTab(t.id)
}

// —— hooks (RTK useAppSelector) ——

export function useTabs() {
  return useAppSelector((s) => s.workspace.tabs)
}
export function useActiveId() {
  return useAppSelector((s) => s.workspace.activeId)
}

/** 当前预览/瞬态标签 id (标签条斜体显示用); 无预览标签 → null。 */
export function useTransientId() {
  return useAppSelector((s) => s.workspace.transientId)
}

export function useDirtyTabIds() {
  return useAppSelector((s) => s.workspace.dirtyTabs)
}

/** 当前激活标签的 kind (活动栏 AI 固定钮高亮用); 无激活标签 → null。 */
export function useActiveTabKind(): string | null {
  return useAppSelector(
    (s) => s.workspace.tabs.find((t) => t.id === s.workspace.activeId)?.kind ?? null,
  )
}

/** 当前激活的 ai-tasks 标签所属工作区 id (AI 侧栏高亮用); 否则 null。 */
export function useActiveWorkspaceId(): string | null {
  return useAppSelector((s) => {
    const t = s.workspace.tabs.find((x) => x.id === s.workspace.activeId)
    return t?.kind === "ai-tasks" ? (t.params?.workspaceId ?? null) : null
  })
}
export function useActiveModule() {
  return useAppSelector((s) => s.workspace.activeModule)
}
export function useMode() {
  return useAppSelector((s) => s.workspace.mode)
}
export function useSidebarCollapsed() {
  return useAppSelector((s) => s.workspace.sidebarCollapsed)
}
export function useRightPanelOpen() {
  return useAppSelector((s) => s.workspace.rightPanelOpen)
}
export function useHydrated() {
  return useAppSelector((s) => s.workspace.hydrated)
}

/** 标签访问序 (LRU, 最近激活在末尾)。⌘K「打开的标签」按最近优先排序用。 */
export function useLru() {
  return useAppSelector((s) => s.workspace.lru)
}

/** 非响应式实时读取 (effect 内用): 拿 store 当前快照, 而非组件渲染闭包里的旧值。 */
export function getActiveId(): string | null {
  return ws().activeId
}
/** 当前预览/瞬态标签 id 的实时快照 (effect / 测试用)。 */
export function getTransientId(): string | null {
  return ws().transientId
}
/** 当前工作区模式视图的实时快照 (effect / 测试用)。 */
export function getMode(): WsMode {
  return ws().mode
}
/** 当前左侧导航/侧栏模块的实时快照 (effect / 测试用)。 */
export function getActiveModule(): ModuleId {
  return ws().activeModule
}
/** 当前激活节点的激活来源 (user / agent)。隐私: active-node 端口对 agent 自激活的节点返回 null, 不计入隐式同意。 */
export function getActiveSource(): ActiveSource {
  return ws().activeSource
}
export function getTabs(): Tab[] {
  return ws().tabs
}
