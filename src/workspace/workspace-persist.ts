import type { DevelopmentTool, ModuleId, Tab, WorkspaceKind } from "./types"
import { WORKSPACE_STORAGE_KEY } from "@/lib/workspace-storage"

export { WORKSPACE_STORAGE_KEY }

export const WORKSPACE_PERSIST_VERSION = 2

export type WorkspacePersistSnapshot = {
  tabs: Tab[]
  activeId: string | null
  transientId: string | null
  activeModule: ModuleId
  activeRootId: string
  workspaceKind: WorkspaceKind
  developmentTool: DevelopmentTool
  sidebarCollapsed: boolean
  rightPanelOpen: boolean
}

let pendingSnapshot: { state: WorkspacePersistSnapshot; hydrated: boolean } | null = null
let persistenceScheduled = false
let flushListenersInstalled = false

/** 双写 sessionStorage + localStorage (桌面 App 跨重启恢复)。hydrated 为 false 时不写。 */
export function persistWorkspaceSnapshot(state: WorkspacePersistSnapshot, hydrated: boolean) {
  if (typeof window === "undefined" || !hydrated) return
  try {
    const snapshot = JSON.stringify({
      version: WORKSPACE_PERSIST_VERSION,
      tabs: state.tabs,
      activeId: state.activeId,
      transientId: state.transientId,
      activeModule: state.activeModule,
      activeRootId: state.activeRootId,
      workspaceKind: state.workspaceKind,
      developmentTool: state.developmentTool,
      sidebarCollapsed: state.sidebarCollapsed,
      rightPanelOpen: state.rightPanelOpen,
    })
    window.sessionStorage.setItem(WORKSPACE_STORAGE_KEY, snapshot)
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, snapshot)
  } catch {
    /* 隐私模式 / 配额满 → 放弃持久化 */
  }
}

/** Flush the latest coalesced workspace state. Exported for lifecycle boundaries and tests. */
export function flushWorkspaceSnapshotPersistence(): void {
  persistenceScheduled = false
  const pending = pendingSnapshot
  pendingSnapshot = null
  if (pending) persistWorkspaceSnapshot(pending.state, pending.hydrated)
}

function installFlushListeners(): void {
  if (flushListenersInstalled || typeof window === "undefined") return
  flushListenersInstalled = true
  // Idle work may not run before a desktop window closes or a mobile webview is backgrounded.
  window.addEventListener("pagehide", flushWorkspaceSnapshotPersistence)
  window.document.addEventListener("visibilitychange", () => {
    if (window.document.visibilityState === "hidden") flushWorkspaceSnapshotPersistence()
  })
}

/**
 * Persistence is durability work, not part of the click-to-paint critical path. Collapse a burst
 * of Redux patches and write the newest snapshot once when the browser is idle. The page lifecycle
 * listeners above still force a synchronous final write when the app is hidden or closed.
 */
export function scheduleWorkspaceSnapshotPersistence(
  state: WorkspacePersistSnapshot,
  hydrated: boolean,
): void {
  if (typeof window === "undefined" || !hydrated) return
  pendingSnapshot = { state, hydrated }
  if (persistenceScheduled) return
  persistenceScheduled = true
  installFlushListeners()
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(flushWorkspaceSnapshotPersistence, { timeout: 250 })
  } else {
    window.setTimeout(flushWorkspaceSnapshotPersistence, 0)
  }
}
