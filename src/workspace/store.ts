"use client"

/**
 * Workspace store 公共兼容入口。
 *
 * 具体职责位于 store/：恢复与持久化边界、文件导航、标签生命周期和选择器。
 * 调用方继续从 workspace/store 导入，避免内部组织方式泄漏到产品模块。
 */
export type { ActiveSource } from "./workspace-slice"
export type { OpenTarget } from "./open-target"
export { tabKey } from "./tab-key"
export { migrateWorkspaceTab, migrateWorkspaceTabs } from "./workspace-compat"

export { hydrateWorkspace } from "./store/persistence"

export {
  activateAdjacentTab,
  activateTabAt,
  closeActiveTab,
  closeAllTabs,
  closeFileTabs,
  closeNodeTabs,
  closeOtherTabs,
  closeTab,
  isTabDirty,
  openTab,
  promoteActiveTab,
  promoteTab,
  renameNodeTab,
  reorderTabs,
  requestCloseActiveTab,
  requestCloseAllTabs,
  requestCloseOtherTabs,
  requestCloseTab,
  setActiveTab,
  setTabDirty,
  setTabSuspendReady,
  subscribeDirtyTabCloseRequests,
  type DirtyTabCloseRequest,
} from "./store/tab-lifecycle"

export {
  cancelRouteFileOpen,
  openAiSection,
  openAiSettings,
  openAiTasks,
  openRouteFileTarget,
  openSettings,
  openStartupTarget,
  openTarget,
  setDevelopmentTool,
  setRightPanel,
  setSidebarCollapsed,
  setWorkspaceKind,
  toggleFileRoot,
  toggleModule,
  toggleMountedFileRoot,
  toggleRightPanel,
  toggleSidebar,
  toggleWorkspace,
} from "./store/navigation"

export {
  getActiveId,
  getActiveModule,
  getActiveRootId,
  getActiveSource,
  getDevelopmentTool,
  getRouteOpenPending,
  getTabs,
  getTransientId,
  getWorkspaceKind,
  useActiveId,
  useActiveModule,
  useActiveRootId,
  useActiveTabKind,
  useActiveWorkspaceId,
  useDevelopmentTool,
  useDirtyTabIds,
  useHydrated,
  useLru,
  useRightPanelOpen,
  useRouteOpenPending,
  useSidebarCollapsed,
  useSuspendReadyTabIds,
  useTabs,
  useTransientId,
  useWorkspaceKind,
} from "./store/selectors"
