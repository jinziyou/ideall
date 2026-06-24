"use client"

// 工作区状态 (多标签 + 活动模块 + 二级侧栏折叠)。
// 用 useSyncExternalStore (与本仓库 sync-code / session / theme 同范式), 不引入额外状态库。
// 标签 keep-alive: 内容由 tab-host 全部挂载、非激活态 display:none (iframe 等不重载)。

import * as React from "react"
import type { ModuleId, Tab, TabDescriptor, WsMode } from "./types"
import { nodeTab, parseNodeParams } from "./node-tab"
import type { NodeRef } from "./node-ref"

const STORAGE_KEY = "ideall:workspace:v1"

/** 模块 → 工作区模式 (本地 / 连接)。打开标签时据此自动同步模式镜头。 */
const MODE_OF: Record<ModuleId, WsMode> = {
  home: "local",
  subscriptions: "local",
  following: "local",
  info: "connected",
  community: "connected",
  tool: "connected",
  agent: "connected",
}

type State = {
  tabs: Tab[]
  activeId: string | null
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
    state = {
      ...state,
      tabs: merged,
      activeId: activeTab ? activeTab.id : null,
      // 模块/模式由激活标签派生, 保证三者自洽 (避免与 URL 短暂错位)。
      activeModule: activeTab
        ? activeTab.module
        : state.activeId
          ? state.activeModule
          : saved.activeModule,
      mode: activeTab ? MODE_OF[activeTab.module] : state.activeId ? state.mode : saved.mode,
      rightPanelOpen: saved.rightPanelOpen,
      hydrated: true,
    }
  } else {
    state = { ...state, hydrated: true }
  }
  emit()
}

// —— 动作 ——

/** 打开 (或激活已存在的) 标签。同时把模式镜头同步到该标签所属模式。 */
export function openTab(d: TabDescriptor) {
  const id = tabKey(d)
  const exists = state.tabs.some((t) => t.id === id)
  const tabs = exists ? state.tabs : [...state.tabs, { ...d, id }]
  setState({ tabs, activeId: id, activeModule: d.module, mode: MODE_OF[d.module] })
}

/** 打开 (或激活已存在的) 一个节点标签。三入口 (搜索/侧栏/AI) 统一经此, 保证 entity 级去重。 */
export function openNodeTab(ref: NodeRef, title: string) {
  openTab(nodeTab(ref, title))
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
    if (next) {
      activeModule = next.module
      mode = MODE_OF[next.module]
    }
  }
  setState({ tabs, activeId, activeModule, mode })
}

export function setActiveTab(id: string) {
  const t = state.tabs.find((x) => x.id === id)
  if (!t) return
  setState({ activeId: id, activeModule: t.module, mode: MODE_OF[t.module] })
}

/** 选中模块 (展开其二级侧栏)。 */
export function setActiveModule(m: ModuleId) {
  setState({ activeModule: m, mode: MODE_OF[m], sidebarCollapsed: false })
}

/** 点活动栏图标: 同模块且侧栏展开 → 收起; 否则切到该模块并展开。 */
export function toggleModule(m: ModuleId) {
  if (state.activeModule === m && !state.sidebarCollapsed) {
    setState({ sidebarCollapsed: true })
  } else {
    setState({ activeModule: m, mode: MODE_OF[m], sidebarCollapsed: false })
  }
}

/** 切换工作区模式 (本地 / 连接)。镜头切换: 活动模块归到该模式首个模块, 展开侧栏。 */
export function setMode(mode: WsMode) {
  const first: ModuleId = mode === "local" ? "home" : "info"
  setState({ mode, activeModule: first, sidebarCollapsed: false })
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
export function getTabs(): Tab[] {
  return state.tabs
}
