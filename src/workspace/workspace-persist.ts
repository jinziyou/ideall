import type { ModuleId, Tab, WsMode } from "./types"
import { WORKSPACE_STORAGE_KEY } from "@/lib/workspace-storage"

export { WORKSPACE_STORAGE_KEY }

export type WorkspacePersistSnapshot = {
  tabs: Tab[]
  activeId: string | null
  transientId: string | null
  activeModule: ModuleId
  activeRootId: string
  mode: WsMode
  sidebarCollapsed: boolean
  rightPanelOpen: boolean
}

/** 双写 sessionStorage + localStorage (桌面 App 跨重启恢复)。hydrated 为 false 时不写。 */
export function persistWorkspaceSnapshot(state: WorkspacePersistSnapshot, hydrated: boolean) {
  if (typeof window === "undefined" || !hydrated) return
  try {
    const snapshot = JSON.stringify({
      tabs: state.tabs,
      activeId: state.activeId,
      transientId: state.transientId,
      activeModule: state.activeModule,
      activeRootId: state.activeRootId,
      mode: state.mode,
      sidebarCollapsed: state.sidebarCollapsed,
      rightPanelOpen: state.rightPanelOpen,
    })
    sessionStorage.setItem(WORKSPACE_STORAGE_KEY, snapshot)
    localStorage.setItem(WORKSPACE_STORAGE_KEY, snapshot)
  } catch {
    /* 隐私模式 / 配额满 → 放弃持久化 */
  }
}
