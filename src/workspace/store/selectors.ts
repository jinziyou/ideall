"use client"

import type { DevelopmentTool, ModuleId, Tab, WorkspaceKind, WsMode } from "../types"
import type { ActiveSource } from "../workspace-slice"
import { fileEngineTargetForTab } from "../file-tab"
import { panelForFile } from "@/filesystem/resource-file-system"
import { useAppSelector } from "@/lib/store"
import { workspaceState } from "./runtime"

export function useTabs() {
  return useAppSelector((state) => state.workspace.tabs)
}

export function useActiveId() {
  return useAppSelector((state) => state.workspace.activeId)
}

export function useTransientId() {
  return useAppSelector((state) => state.workspace.transientId)
}

export function useDirtyTabIds() {
  return useAppSelector((state) => state.workspace.dirtyTabs)
}

export function useSuspendReadyTabIds() {
  return useAppSelector((state) => state.workspace.suspendReadyTabs)
}

export function useActiveTabKind(): string | null {
  return useAppSelector(
    (state) =>
      state.workspace.tabs.find((tab) => tab.id === state.workspace.activeId)?.kind ?? null,
  )
}

export function useActiveWorkspaceId(): string | null {
  return useAppSelector((state) => {
    const tab = state.workspace.tabs.find((candidate) => candidate.id === state.workspace.activeId)
    if (tab?.kind === "ai-tasks") return tab.params?.workspaceId ?? null
    const target = fileEngineTargetForTab(tab)
    if (!target) return null
    const panel = panelForFile(target.ref)
    return panel?.tabKind === "ai-tasks" ? (panel.params?.workspaceId ?? null) : null
  })
}

export function useActiveModule() {
  return useAppSelector((state) => state.workspace.activeModule)
}

export function useActiveRootId() {
  return useAppSelector((state) => state.workspace.activeRootId)
}

export function useMode() {
  return useAppSelector((state) => state.workspace.mode)
}

export function useWorkspaceKind() {
  return useAppSelector((state) => state.workspace.workspaceKind)
}

export function useDevelopmentTool() {
  return useAppSelector((state) => state.workspace.developmentTool)
}

export function useSidebarCollapsed() {
  return useAppSelector((state) => state.workspace.sidebarCollapsed)
}

export function useRightPanelOpen() {
  return useAppSelector((state) => state.workspace.rightPanelOpen)
}

export function useHydrated() {
  return useAppSelector((state) => state.workspace.hydrated)
}

export function useRouteOpenPending() {
  return useAppSelector((state) => state.workspace.routeOpenPending)
}

/** 标签访问序，最近激活项位于末尾。 */
export function useLru() {
  return useAppSelector((state) => state.workspace.lru)
}

export function getActiveId(): string | null {
  return workspaceState().activeId
}

export function getTransientId(): string | null {
  return workspaceState().transientId
}

export function getMode(): WsMode {
  return workspaceState().mode
}

export function getWorkspaceKind(): WorkspaceKind {
  return workspaceState().workspaceKind
}

export function getDevelopmentTool(): DevelopmentTool {
  return workspaceState().developmentTool
}

export function getActiveModule(): ModuleId {
  return workspaceState().activeModule
}

export function getActiveRootId(): string {
  return workspaceState().activeRootId
}

export function getActiveSource(): ActiveSource {
  return workspaceState().activeSource
}

export function getTabs(): Tab[] {
  return workspaceState().tabs
}

export function getRouteOpenPending(): boolean {
  return workspaceState().routeOpenPending
}
