"use client"

import type { DevelopmentTool, ModuleId, Tab, WorkspaceKind } from "../types"
import { isBrowserResourceTab } from "../resource-tab"
import { coreFileRootForModule, normalizeNavigationRootId } from "../file-roots"
import { WORKSPACE_STORAGE_KEY } from "../workspace-persist"
import { migrateWorkspaceTabs, validWorkspaceModule } from "../workspace-compat"
import { browserRelease, isTauri } from "@/lib/tauri"
import { hydrateWorkspaceState, workspaceState } from "./runtime"

type PersistedWorkspace = {
  tabs: Tab[]
  activeId: string | null
  transientId: string | null
  activeModule: ModuleId
  activeRootId: string | null
  workspaceKind: WorkspaceKind
  developmentTool: DevelopmentTool
  sidebarCollapsed: boolean
  rightPanelOpen: boolean
}

function validWorkspaceKind(value: unknown): WorkspaceKind {
  return value === "audio" || value === "development" || value === "files" ? value : "files"
}

function validDevelopmentTool(value: unknown): DevelopmentTool {
  return value === "shell" || value === "git" || value === "database" ? value : "git"
}

function readPersistedWorkspace(): PersistedWorkspace | null {
  try {
    const raw =
      sessionStorage.getItem(WORKSPACE_STORAGE_KEY) ?? localStorage.getItem(WORKSPACE_STORAGE_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as {
      tabs?: Tab[]
      activeId?: string | null
      transientId?: string | null
      activeModule?: ModuleId
      activeRootId?: string
      workspaceKind?: WorkspaceKind
      developmentTool?: DevelopmentTool
      sidebarCollapsed?: boolean
      rightPanelOpen?: boolean
    }
    if (!Array.isArray(value.tabs)) return null
    return {
      tabs: value.tabs,
      activeId: value.activeId ?? null,
      transientId: value.transientId ?? null,
      activeModule: validWorkspaceModule(value.activeModule) ?? "home",
      activeRootId:
        typeof value.activeRootId === "string" && value.activeRootId ? value.activeRootId : null,
      workspaceKind: validWorkspaceKind(value.workspaceKind),
      developmentTool: validDevelopmentTool(value.developmentTool),
      sidebarCollapsed: value.sidebarCollapsed ?? false,
      rightPanelOpen: value.rightPanelOpen ?? false,
    }
  } catch {
    return null
  }
}

/**
 * 客户端挂载后恢复工作区。sessionStorage 优先，localStorage 作为跨重启快照；
 * 恢复结果与路由已打开的标签合并，旧标签只在这里经过兼容迁移。
 */
export function hydrateWorkspace(): void {
  if (workspaceState().hydrated || typeof window === "undefined") return
  const saved = readPersistedWorkspace()
  if (saved) {
    const current = workspaceState()
    const { tabs: validTabs, idMap } = migrateWorkspaceTabs(saved.tabs)
    const tabs = [...validTabs]
    for (const tab of current.tabs) {
      if (!tabs.some((candidate) => candidate.id === tab.id)) tabs.push(tab)
    }
    const savedActiveId = saved.activeId ? (idMap.get(saved.activeId) ?? saved.activeId) : null
    const requestedActiveId = current.activeId ?? savedActiveId
    const activeTab = requestedActiveId
      ? (tabs.find((tab) => tab.id === requestedActiveId) ?? null)
      : null
    const savedTransientId = saved.transientId
      ? (idMap.get(saved.transientId) ?? saved.transientId)
      : null
    const requestedRootId =
      current.activeId && activeTab
        ? (activeTab.rootId ?? current.activeRootId)
        : (activeTab?.rootId ?? saved.activeRootId ?? coreFileRootForModule(saved.activeModule).id)

    hydrateWorkspaceState({
      tabs,
      activeId: activeTab?.id ?? null,
      transientId:
        savedTransientId && tabs.some((tab) => tab.id === savedTransientId)
          ? savedTransientId
          : null,
      lru: activeTab ? [activeTab.id] : [],
      activeSource: "user",
      activeModule:
        activeTab?.module ?? (current.activeId ? current.activeModule : saved.activeModule),
      activeRootId: normalizeNavigationRootId(requestedRootId),
      workspaceKind: saved.workspaceKind,
      developmentTool: saved.developmentTool,
      sidebarCollapsed: saved.sidebarCollapsed,
      rightPanelOpen: saved.rightPanelOpen,
    })
  } else {
    hydrateWorkspaceState({})
  }

  if (isTauri()) {
    const { tabs, activeId } = workspaceState()
    const active = tabs.find((tab) => tab.id === activeId)
    if (!active || !isBrowserResourceTab(active)) void browserRelease().catch(() => {})
  }
}
