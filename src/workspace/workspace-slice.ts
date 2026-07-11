import { createSlice, type PayloadAction } from "@reduxjs/toolkit"
import type { DevelopmentTool, ModuleId, Tab, WorkspaceKind, WsMode } from "./types"

/** 激活来源: user=用户 · agent=AI 经 ui.openTab。 */
export type ActiveSource = "user" | "agent"

export type WorkspaceState = {
  tabs: Tab[]
  activeId: string | null
  transientId: string | null
  activeSource: ActiveSource
  activeModule: ModuleId
  /** 合成文件系统根目录下当前选中的直接子树。 */
  activeRootId: string
  mode: WsMode
  workspaceKind: WorkspaceKind
  developmentTool: DevelopmentTool
  sidebarCollapsed: boolean
  rightPanelOpen: boolean
  lru: string[]
  dirtyTabs: string[]
  /** dirty Engine 已成功写入可恢复快照，可安全按 LRU 卸载。 */
  suspendReadyTabs: string[]
  hydrated: boolean
  /** 显式路由正在解析 FileRef；URL 镜像在完成前不得回写旧活动标签。 */
  routeOpenPending: boolean
}

export const workspaceInitialState: WorkspaceState = {
  tabs: [],
  activeId: null,
  transientId: null,
  activeSource: "user",
  activeModule: "home",
  activeRootId: "home",
  mode: "local",
  workspaceKind: "files",
  developmentTool: "git",
  sidebarCollapsed: false,
  rightPanelOpen: false,
  lru: [],
  dirtyTabs: [],
  suspendReadyTabs: [],
  hydrated: false,
  routeOpenPending: false,
}

function applyDerivedAfterPatch(
  state: WorkspaceState,
  patch: Partial<WorkspaceState>,
  prevActive: string | null,
) {
  if (state.activeId && state.activeId !== prevActive) {
    state.lru = [...state.lru.filter((id) => id !== state.activeId), state.activeId]
  }
  if (patch.tabs) {
    const ids = new Set(state.tabs.map((t) => t.id))
    state.lru = state.lru.filter((id) => ids.has(id))
    state.dirtyTabs = state.dirtyTabs.filter((id) => ids.has(id))
    state.suspendReadyTabs = state.suspendReadyTabs.filter((id) => ids.has(id))
  }
}

export const workspaceSlice = createSlice({
  name: "workspace",
  initialState: workspaceInitialState,
  reducers: {
    patch(state, action: PayloadAction<Partial<WorkspaceState>>) {
      const prevActive = state.activeId
      Object.assign(state, action.payload)
      applyDerivedAfterPatch(state, action.payload, prevActive)
    },
    hydrate(state, action: PayloadAction<Partial<WorkspaceState>>) {
      Object.assign(state, action.payload, { hydrated: true })
    },
  },
})

export const workspaceActions = workspaceSlice.actions
