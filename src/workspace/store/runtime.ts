"use client"

import type { TabDescriptor } from "../types"
import { isBrowserResourceTab } from "../resource-tab"
import { NavigationRequestCoordinator } from "../navigation-request-coordinator"
import { clearEngineSuspendSnapshot } from "../engine-suspension"
import { workspaceActions, type WorkspaceState } from "../workspace-slice"
import { isTauri, browserRelease } from "@/lib/tauri"
import { store } from "@/lib/store"

/** Store 子模块共享的最小运行时边界；不作为 workspace/store 的公共 API 导出。 */
export function workspaceState(): WorkspaceState {
  return store.getState().workspace
}

export function patchWorkspace(patch: Partial<WorkspaceState>): void {
  if (patch.tabs) {
    const nextIds = new Set(patch.tabs.map((tab) => tab.id))
    for (const tab of workspaceState().tabs) {
      if (!nextIds.has(tab.id)) clearEngineSuspendSnapshot(tab.id)
    }
  }
  store.dispatch(workspaceActions.patch(patch))
}

export function hydrateWorkspaceState(patch: Partial<WorkspaceState>): void {
  store.dispatch(workspaceActions.hydrate(patch))
}

export function dirtyTabSet(): Set<string> {
  return new Set(workspaceState().dirtyTabs)
}

export const fileOpenRequests = new NavigationRequestCoordinator()
export const pathOpenRequests = new NavigationRequestCoordinator()
export const routeFileOpenRequests = new NavigationRequestCoordinator()
export const workspaceEngineOpenRequests = new NavigationRequestCoordinator()

export function invalidatePendingFileOpen(): void {
  fileOpenRequests.invalidate()
  pathOpenRequests.invalidate()
}

/** 切离浏览器标签时收起原生子 webview，避免其覆盖其他渲染引擎。 */
export function hideBrowserWebviewUnlessBrowserTab(
  tab: Pick<TabDescriptor, "kind" | "params">,
): void {
  if (isBrowserResourceTab(tab)) return
  if (isTauri()) void browserRelease().catch(() => {})
}
