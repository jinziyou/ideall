import { createSlice, type PayloadAction } from "@reduxjs/toolkit"
import type { ModuleId, Tab, WsMode } from "./types"

/** 激活来源: user=用户 · agent=AI 经 ui.openTab。 */
export type ActiveSource = "user" | "agent"

export type WorkspaceState = {
  tabs: Tab[]
  activeId: string | null
  transientId: string | null
  activeSource: ActiveSource
  activeModule: ModuleId
  mode: WsMode
  sidebarCollapsed: boolean
  rightPanelOpen: boolean
  lru: string[]
  hydrated: boolean
}

export const workspaceInitialState: WorkspaceState = {
  tabs: [],
  activeId: null,
  transientId: null,
  activeSource: "user",
  activeModule: "home",
  mode: "local",
  sidebarCollapsed: false,
  rightPanelOpen: false,
  lru: [],
  hydrated: false,
}

function applyLruAfterPatch(state: WorkspaceState, patch: Partial<WorkspaceState>, prevActive: string | null) {
  if (state.activeId && state.activeId !== prevActive) {
    state.lru = [...state.lru.filter((id) => id !== state.activeId), state.activeId]
  }
  if (patch.tabs) {
    const ids = new Set(state.tabs.map((t) => t.id))
    state.lru = state.lru.filter((id) => ids.has(id))
  }
}

export const workspaceSlice = createSlice({
  name: "workspace",
  initialState: workspaceInitialState,
  reducers: {
    patch(state, action: PayloadAction<Partial<WorkspaceState>>) {
      const prevActive = state.activeId
      Object.assign(state, action.payload)
      applyLruAfterPatch(state, action.payload, prevActive)
    },
    hydrate(state, action: PayloadAction<Partial<WorkspaceState>>) {
      Object.assign(state, action.payload, { hydrated: true })
    },
  },
})

export const workspaceActions = workspaceSlice.actions
