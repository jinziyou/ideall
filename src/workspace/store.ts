"use client"

// 工作区状态 (多标签 + 活动模块 + 二级侧栏折叠)。
// 用 useSyncExternalStore (与本仓库 sync-code / session / theme 同范式), 不引入额外状态库。
// 标签 keep-alive: 内容由 tab-host 全部挂载、非激活态 display:none (iframe 等不重载)。

import * as React from "react"
import type { ModuleId, Tab, TabDescriptor, WsMode } from "./types"
import { nodeTab, parseNodeParams } from "./node-tab"
import type { NodeRef } from "./node-ref"
import { HOME_OVERVIEW } from "./home-sections"
import { moduleById } from "./modules"

const STORAGE_KEY = "ideall:workspace:v1"

/** 模块 → 工作区模式 (本地 / 连接)。打开标签时据此自动同步模式镜头。 */
const MODE_OF: Record<ModuleId, WsMode> = {
  home: "local",
  subscriptions: "local",
  tool: "local",
  info: "connected",
  community: "connected",
  browser: "connected",
  agent: "connected",
}

/** 激活来源: user=用户(侧栏/搜索/标签/路由) · agent=AI 经 ui.openTab。 */
type ActiveSource = "user" | "agent"

type State = {
  tabs: Tab[]
  activeId: string | null
  /** 当前激活节点的激活来源。隐私: agent 经 ui.openTab 自激活的节点**不计入**「打开即隐式同意」——
   *  防 agent 用 ui.openTab 把任意笔记设为活动标签, 再经 referenced-context 自喂其正文给模型端点 (软绕 consent)。 */
  activeSource: ActiveSource
  activeModule: ModuleId
  mode: WsMode
  sidebarCollapsed: boolean
  /** 右侧 AI 对话栏是否展开 (AI 原生: 始终可呼出的右停靠面板)。 */
  rightPanelOpen: boolean
  /** 是否已从 sessionStorage 水合 (SSR/首帧前为 false, 保证与服务端快照一致)。 */
  hydrated: boolean
}

const DEFAULT: State = {
  tabs: [],
  activeId: null,
  activeSource: "user",
  activeModule: "home",
  mode: "local",
  sidebarCollapsed: false,
  rightPanelOpen: false,
  hydrated: false,
}

let state: State = DEFAULT
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}
function subscribe(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}
function setState(patch: Partial<State>) {
  state = { ...state, ...patch }
  persist()
  emit()
}

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
  if (typeof window === "undefined" || !state.hydrated) return
  try {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        tabs: state.tabs,
        activeId: state.activeId,
        activeModule: state.activeModule,
        mode: state.mode,
        rightPanelOpen: state.rightPanelOpen,
      }),
    )
  } catch {
    /* 隐私模式 / 配额满 → 放弃持久化 */
  }
}

/** 客户端挂载后调用一次: 从 sessionStorage 恢复上次的标签。
 *  与路由标记的 openTab 顺序无关 (React 不保证父子 effect 顺序): 采用合并而非覆盖 ——
 *  历史标签在前, 本次会话已开的标签去重并入; 当前路由已设的激活标签优先。 */
export function hydrateWorkspace() {
  if (state.hydrated || typeof window === "undefined") return
  let saved: {
    tabs: Tab[]
    activeId: string | null
    activeModule: ModuleId
    mode: WsMode
    rightPanelOpen: boolean
  } | null = null
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (raw) {
      const p = JSON.parse(raw) as {
        tabs?: Tab[]
        activeId?: string | null
        activeModule?: ModuleId
        mode?: WsMode
        rightPanelOpen?: boolean
      }
      if (Array.isArray(p.tabs)) {
        saved = {
          tabs: p.tabs,
          activeId: p.activeId ?? null,
          activeModule: p.activeModule ?? "home",
          mode: p.mode ?? "local",
          rightPanelOpen: p.rightPanelOpen ?? false,
        }
      }
    }
  } catch {
    /* 损坏数据 → 忽略 */
  }
  if (saved) {
    // 清洗: 丢弃 module 不在 MODE_OF 的污染/陈旧标签 (防 mode 被算成 undefined);
    // 节点标签额外要求 params 能解析出合法 NodeRef (防下线某 kind / 损坏 params 留僵尸标签)。
    const validTabs = saved.tabs.filter(
      (t) => t.module in MODE_OF && (t.kind === "node" ? !!parseNodeParams(t.params) : true),
    )
    const merged = [...validTabs]
    for (const t of state.tabs) if (!merged.some((x) => x.id === t.id)) merged.push(t)
    // 激活标签: marker 先跑设置的当前路由优先, 否则历史; 且必须确实存在于 merged。
    const wantId = state.activeId ?? saved.activeId
    const activeTab = wantId ? (merged.find((x) => x.id === wantId) ?? null) : null
    // AI 区段 (module:"agent") mode-中性: 不由其 module 反推 mode, 沿用持久化的镜头
    // (与 openAgentTab/setActiveTab 一致; 否则「local 下开 AI 再刷新」会被静默翻成 connected)。
    const aiActive = activeTab?.module === "agent"
    state = {
      ...state,
      tabs: merged,
      activeId: activeTab ? activeTab.id : null,
      // 恢复的激活标签视作 user (原本由用户导航而来); 不持久化 source, 防 agent 自激活态跨刷新泄漏。
      activeSource: "user",
      // 模块/模式由激活标签派生, 保证三者自洽 (避免与 URL 短暂错位); AI 工作区例外, 沿用持久化镜头。
      activeModule: aiActive
        ? saved.activeModule
        : activeTab
          ? activeTab.module
          : state.activeId
            ? state.activeModule
            : saved.activeModule,
      mode: aiActive
        ? saved.mode
        : activeTab
          ? MODE_OF[activeTab.module]
          : state.activeId
            ? state.mode
            : saved.mode,
      rightPanelOpen: saved.rightPanelOpen,
      hydrated: true,
    }
  } else {
    state = { ...state, hydrated: true }
  }
  emit()
}

// —— 动作 ——

/** 打开 (或激活已存在的) 标签。同时把模式镜头同步到该标签所属模式。
 *  source 默认 user (UI/路由触发); agent 经 ui.openTab 打开时传 "agent" —— 仅影响隐式同意, 不改打开行为。 */
export function openTab(d: TabDescriptor, source: ActiveSource = "user") {
  const id = tabKey(d)
  const exists = state.tabs.some((t) => t.id === id)
  const tabs = exists ? state.tabs : [...state.tabs, { ...d, id }]
  setState({
    tabs,
    activeId: id,
    activeModule: d.module,
    // AI 区段 (module:"agent") mode-中性: 跨 local/connected 常驻, 打开不翻 mode。
    mode: d.module === "agent" ? state.mode : MODE_OF[d.module],
    activeSource: source,
  })
}

/** AI 全局设置标签 (默认 AI 标签; module:"agent" mode-中性, 跨 local/connected 常驻)。 */
export const AI_SETTINGS_TAB: TabDescriptor = {
  kind: "ai-settings",
  module: "agent",
  title: "AI 设置",
  path: "/ai",
}

/** 打开/激活一个 AI 区段标签: 设 activeModule=agent + 展开 AI 二级侧栏, 但**不改 mode** (AI 跨模式常驻)。 */
function openAgentTab(d: TabDescriptor) {
  const id = tabKey(d)
  const exists = state.tabs.some((t) => t.id === id)
  const tabs = exists ? state.tabs : [...state.tabs, { ...d, id }]
  setState({
    tabs,
    activeId: id,
    activeModule: "agent",
    sidebarCollapsed: false,
    activeSource: "user",
  })
}

/** 点活动栏「AI」/ 默认 AI 标签 = 全局 AI 设置。 */
export function openAiSettings() {
  openAgentTab(AI_SETTINGS_TAB)
}

const AI_SECTION_TITLE: Record<"ai-mcp" | "ai-skills" | "ai-rules", string> = {
  "ai-mcp": "MCP",
  "ai-skills": "Skills",
  "ai-rules": "规则",
}

/** 打开 AI 区段管理标签 (MCP / Skills / 规则)。 */
export function openAiSection(kind: "ai-mcp" | "ai-skills" | "ai-rules") {
  openAgentTab({ kind, module: "agent", title: AI_SECTION_TITLE[kind] })
}

/** 打开某工作空间的任务标签 (params.workspaceId 区分实例; 不设 path → 不参与 URL 同步)。 */
export function openAiTasks(workspaceId: string, title: string) {
  openAgentTab({ kind: "ai-tasks", module: "agent", title, params: { workspaceId } })
}

/** 打开 (或激活已存在的) 一个节点标签。三入口 (搜索/侧栏/AI) 统一经此, 保证 entity 级去重。
 *  AI (boot.ts 的 ui.openTab) 传 source="agent" —— 该节点不计入「打开即隐式同意」(隐私)。 */
export function openNodeTab(ref: NodeRef, title: string, source: ActiveSource = "user") {
  openTab(nodeTab(ref, title), source)
}

/** 节点标签取数后回填真实标题 (不改 id / 去重 key, 仅更新显示)。 */
export function renameNodeTab(ref: NodeRef, title: string) {
  const id = tabKey(nodeTab(ref, title))
  if (!state.tabs.some((t) => t.id === id)) return
  setState({ tabs: state.tabs.map((t) => (t.id === id ? { ...t, title } : t)) })
}

/** 关闭标签; 若关的是激活项, 焦点转移到相邻标签。 */
export function closeTab(id: string) {
  const idx = state.tabs.findIndex((t) => t.id === id)
  if (idx === -1) return
  const tabs = state.tabs.filter((t) => t.id !== id)
  let activeId = state.activeId
  let activeModule = state.activeModule
  let mode = state.mode
  if (state.activeId === id) {
    const next = tabs[idx] ?? tabs[idx - 1] ?? null
    activeId = next ? next.id : null
    // 焦点转移到相邻标签时, 同步活动模块与模式镜头 (否则活动栏/侧栏/状态栏会停在旧模块)。
    // AI 区段 (module:"agent") mode-中性: 焦点落到它时设 activeModule=agent 但保留关闭前的 mode 镜头。
    if (next) {
      if (next.module === "agent") {
        activeModule = "agent"
      } else {
        activeModule = next.module
        mode = MODE_OF[next.module]
      }
    }
  }
  setState({ tabs, activeId, activeModule, mode, activeSource: "user" })
}

export function setActiveTab(id: string) {
  const t = state.tabs.find((x) => x.id === id)
  if (!t) return
  // AI 区段 (module:"agent") mode-中性: 激活它设 activeModule=agent 但不改 mode (否则点 AI 标签会翻 connected)。
  if (t.module === "agent") {
    setState({ activeId: id, activeModule: "agent", activeSource: "user" })
    return
  }
  // 用户主动点标签 = 用户在看它 → 来源 user (即便它原是 agent 经 ui.openTab 开的, 用户点回即视作同意)。
  setState({ activeId: id, activeModule: t.module, mode: MODE_OF[t.module], activeSource: "user" })
}

/** 选中模块 (展开其二级侧栏)。 */
export function setActiveModule(m: ModuleId) {
  setState({ activeModule: m, mode: MODE_OF[m], sidebarCollapsed: false })
}

/** 点活动栏图标: 同模块且侧栏展开 → 收起; 否则切到该模块并展开, 同时开首个面板标签。
 *  注: 「我的」(home) 的活动栏钮不走这里, 改用 openHome (点即开/激活「概览」)。 */
export function toggleModule(m: ModuleId) {
  if (state.activeModule === m && !state.sidebarCollapsed) {
    setState({ sidebarCollapsed: true })
    return
  }
  const mod = moduleById(m)
  const first = mod.entries[0]
  if (!first) {
    setState({ activeModule: m, mode: MODE_OF[m], sidebarCollapsed: false })
    return
  }
  const id = tabKey(first.descriptor)
  const exists = state.tabs.some((t) => t.id === id)
  const tabs = exists ? state.tabs : [...state.tabs, { ...first.descriptor, id }]
  setState({
    tabs,
    activeId: id,
    activeModule: m,
    mode: MODE_OF[m],
    sidebarCollapsed: false,
    activeSource: "user",
  })
}

/** 点活动栏「我的」: 直接开/激活「概览」标签并展开侧栏 (「我的」= 以概览为首页的个人中心)。 */
export function openHome() {
  const id = tabKey(HOME_OVERVIEW)
  const exists = state.tabs.some((t) => t.id === id)
  const tabs = exists ? state.tabs : [...state.tabs, { ...HOME_OVERVIEW, id }]
  setState({
    tabs,
    activeId: id,
    activeModule: "home",
    mode: "local",
    sidebarCollapsed: false,
    activeSource: "user",
  })
}

/** 切换工作区模式 (本地 / 连接)。镜头切换: 活动模块归到该模式首个模块, 展开侧栏并开首个面板/概览标签。 */
export function setMode(mode: WsMode) {
  if (mode === "local") {
    openHome()
    return
  }
  const first: ModuleId = "info"
  const mod = moduleById(first)
  const entry = mod.entries[0]
  if (!entry) {
    setState({ mode, activeModule: first, sidebarCollapsed: false })
    return
  }
  const id = tabKey(entry.descriptor)
  const exists = state.tabs.some((t) => t.id === id)
  const tabs = exists ? state.tabs : [...state.tabs, { ...entry.descriptor, id }]
  setState({
    mode,
    tabs,
    activeId: id,
    activeModule: first,
    sidebarCollapsed: false,
    activeSource: "user",
  })
}

export function setSidebarCollapsed(v: boolean) {
  setState({ sidebarCollapsed: v })
}

/** 切换左侧二级侧栏显隐 (顶栏布局开关)。 */
export function toggleSidebar() {
  setState({ sidebarCollapsed: !state.sidebarCollapsed })
}

/** 右侧 AI 对话栏开关 (顶栏布局开关 / 活动栏 AI / 移动底栏 AI)。 */
export function toggleRightPanel() {
  setState({ rightPanelOpen: !state.rightPanelOpen })
}
export function setRightPanel(v: boolean) {
  setState({ rightPanelOpen: v })
}

/** 拖拽重排: 把 fromId 移动到 toId 的位置。 */
export function reorderTabs(fromId: string, toId: string) {
  const from = state.tabs.findIndex((t) => t.id === fromId)
  const to = state.tabs.findIndex((t) => t.id === toId)
  if (from === -1 || to === -1 || from === to) return
  const tabs = [...state.tabs]
  const [moved] = tabs.splice(from, 1)
  tabs.splice(to, 0, moved)
  setState({ tabs })
}

// —— hooks (各返回稳定快照, 避免 useSyncExternalStore 抖动) ——

export function useTabs() {
  return React.useSyncExternalStore(
    subscribe,
    () => state.tabs,
    () => DEFAULT.tabs,
  )
}
export function useActiveId() {
  return React.useSyncExternalStore(
    subscribe,
    () => state.activeId,
    () => DEFAULT.activeId,
  )
}

/** 当前激活标签的 kind (活动栏 AI 钉钮高亮用); 无激活标签 → null。 */
export function useActiveTabKind(): string | null {
  return React.useSyncExternalStore(
    subscribe,
    () => state.tabs.find((t) => t.id === state.activeId)?.kind ?? null,
    () => null,
  )
}

/** 当前激活的 ai-tasks 标签所属工作空间 id (AI 侧栏高亮用; 返回原始串保证快照稳定); 否则 null。 */
export function useActiveWorkspaceId(): string | null {
  return React.useSyncExternalStore(
    subscribe,
    () => {
      const t = state.tabs.find((x) => x.id === state.activeId)
      return t?.kind === "ai-tasks" ? (t.params?.workspaceId ?? null) : null
    },
    () => null,
  )
}
export function useActiveModule() {
  return React.useSyncExternalStore(
    subscribe,
    () => state.activeModule,
    () => DEFAULT.activeModule,
  )
}
export function useMode() {
  return React.useSyncExternalStore(
    subscribe,
    () => state.mode,
    () => DEFAULT.mode,
  )
}
export function useSidebarCollapsed() {
  return React.useSyncExternalStore(
    subscribe,
    () => state.sidebarCollapsed,
    () => DEFAULT.sidebarCollapsed,
  )
}
export function useRightPanelOpen() {
  return React.useSyncExternalStore(
    subscribe,
    () => state.rightPanelOpen,
    () => DEFAULT.rightPanelOpen,
  )
}
export function useHydrated() {
  return React.useSyncExternalStore(
    subscribe,
    () => state.hydrated,
    () => DEFAULT.hydrated,
  )
}

/** 非响应式实时读取 (effect 内用): 拿 store 当前快照, 而非组件渲染闭包里的旧值。 */
export function getActiveId(): string | null {
  return state.activeId
}
/** 当前激活节点的激活来源 (user / agent)。隐私: active-node 端口对 agent 自激活的节点返回 null, 不计入隐式同意。 */
export function getActiveSource(): ActiveSource {
  return state.activeSource
}
export function getTabs(): Tab[] {
  return state.tabs
}
