"use client"

import type { DevelopmentTool, ModuleId, WorkspaceKind, WsMode } from "../types"
import type { OpenTarget } from "../open-target"
import type { ActiveSource } from "../workspace-slice"
import { tabKey } from "../tab-key"
import { coerceActiveModuleForMode, isModeNeutralModule, moduleById } from "../modules"
import {
  builtinAppSurfaceForLegacyPanel,
  coerceCoreFileRootIdForMode,
  coreFileRoot,
  coreFileRootForModule,
  coreFileRootMode,
  mountedFileRootId,
} from "../file-roots"
import { FILE_ENGINE_TAB_KIND, fileEngineTab, fileEngineTargetForTab } from "../file-tab"
import { DEFAULT_STARTUP_TARGET, readStartupTarget } from "../startup-target"
import { canOpenStandaloneWindow } from "../standalone-window-policy"
import { resolveWorkspaceEngine } from "../workspace-engine"
import { inferredRootIdForFile, migrateWorkspaceTab } from "../workspace-compat"
import { planTransientTabOpen } from "../tab-lifecycle"
import { statFile } from "@/filesystem/registry"
import { aiTasksPanelFileRef, panelFileRef } from "@/filesystem/resource-file-system"
import { engineRegistry } from "@/engines/builtin"
import { enginePreferencesStorageKey, readEnginePreferences } from "@/engines/preferences"
import { openEngineWindow } from "@/lib/engine-window"
import { setActiveWorkspace } from "@/plugins/agent/lib/agent-workspace"
import { fileRefKey, sameFileRef, type FileRef } from "@protocol/file-system"
import { openTab, type OpenTabOptions } from "./tab-lifecycle"
import {
  fileOpenRequests,
  hideBrowserWebviewUnlessBrowserTab,
  invalidatePendingFileOpen,
  patchWorkspace,
  routeFileOpenRequests,
  workspaceEngineOpenRequests,
  workspaceState,
} from "./runtime"

/**
 * 模块到数据来源模式的映射。只有显式模块导航会同步模式；标签激活不会改变模式。
 */
const MODE_OF: Record<ModuleId, WsMode> = {
  home: "local",
  subscriptions: "local",
  apps: "local",
  plugins: "local",
  shell: "local",
  git: "local",
  database: "local",
  audio: "local",
  code: "local",
  trash: "local",
  tool: "connected",
  info: "connected",
  community: "connected",
  publications: "connected",
  browser: "connected",
  agent: "connected",
}

export function openSettings(): void {
  openTarget({ type: "file", ref: panelFileRef("settings"), rootId: "system" })
}

export function openAiSettings(options?: OpenTabOptions): void {
  patchWorkspace({ activeModule: "agent", sidebarCollapsed: true })
  openTarget({
    type: "file",
    ref: panelFileRef("ai-settings"),
    rootId: "workspace",
    transient: options?.transient,
  })
}

export function openAiSection(
  kind: "ai-mcp" | "ai-skills" | "ai-rules",
  options?: OpenTabOptions,
): void {
  patchWorkspace({ activeModule: "agent", sidebarCollapsed: true })
  openTarget({
    type: "file",
    ref: panelFileRef(kind),
    rootId: "workspace",
    transient: options?.transient,
  })
}

export function openAiTasks(workspaceId: string, title: string, options?: OpenTabOptions): void {
  setActiveWorkspace(workspaceId)
  patchWorkspace({ activeModule: "agent", sidebarCollapsed: true })
  openTarget({
    type: "file",
    ref: aiTasksPanelFileRef(workspaceId),
    title,
    rootId: "workspace",
    transient: options?.transient,
  })
}

async function openFileTarget(
  target: Extract<OpenTarget, { type: "file" }>,
  source: ActiveSource,
  shouldCommit?: () => boolean,
): Promise<boolean> {
  const legacySurface = builtinAppSurfaceForLegacyPanel(target.ref)
  if (legacySurface) {
    target = {
      ...target,
      ref: legacySurface.ref,
      file: undefined,
      engineId: legacySurface.engineId,
      rootId: mountedFileRootId(legacySurface.ref),
    }
  }

  const request = fileOpenRequests.begin()
  const canCommit = () => request.isCurrent() && (shouldCommit?.() ?? true)
  const current = workspaceState()
  const navigationRootId = target.rootId
    ? coerceCoreFileRootIdForMode(target.rootId, current.mode, current.activeRootId)
    : undefined
  if (navigationRootId) patchWorkspace({ activeRootId: navigationRootId })

  try {
    const hintedFile = target.file && sameFileRef(target.file.ref, target.ref) ? target.file : null
    const file =
      target.display !== "window" && hintedFile
        ? hintedFile
        : await statFile(target.ref, { actor: "ui", permissions: [], intent: "metadata" })
    if (!file || !canCommit()) return false

    // stat 期间工作区可能切换；无显式 Engine 时按当前场景重新解析。
    const workspaceKind = workspaceState().workspaceKind
    const candidates = engineRegistry.matching(file)
    const requested = target.engineId
      ? candidates.find((candidate) => candidate.descriptor.engineId === target.engineId)
      : undefined
    const preferences = readEnginePreferences(
      typeof window === "undefined" ? undefined : window.localStorage,
      enginePreferencesStorageKey(workspaceKind),
    )
    const resolved =
      requested ??
      resolveWorkspaceEngine(
        file,
        workspaceKind,
        candidates,
        engineRegistry.resolve(file, preferences),
      )
    if (!resolved) return false
    if (navigationRootId && workspaceState().activeRootId !== navigationRootId) return false

    const engineId = resolved.descriptor.engineId
    if (target.display === "window") {
      if (!canOpenStandaloneWindow(file, resolved.descriptor)) return false
      await openEngineWindow(fileRefKey(file.ref), engineId)
      return true
    }

    const provisional = fileEngineTab({ ref: file.ref, name: target.title || file.name }, engineId)
    const existingRootId = workspaceState().tabs.find(
      (tab) => tab.id === tabKey(provisional),
    )?.rootId
    const rootId = target.rootId ?? existingRootId ?? inferredRootIdForFile(file.ref)
    openTab(
      fileEngineTab(
        { ref: file.ref, name: target.title || file.name },
        engineId,
        rootId ? { rootId } : {},
      ),
      source,
      { transient: target.transient },
    )
    if (rootId) {
      const state = workspaceState()
      patchWorkspace({
        activeRootId: coerceCoreFileRootIdForMode(rootId, state.mode, state.activeRootId),
      })
    }
    return true
  } catch {
    return false
  }
}

/** 路由专用、可等待的文件打开；后发导航会让旧请求失效。 */
export async function openRouteFileTarget(
  target: Extract<OpenTarget, { type: "file" }>,
  source: ActiveSource = "user",
): Promise<boolean> {
  const request = routeFileOpenRequests.begin()
  patchWorkspace({ routeOpenPending: true })
  try {
    return await openFileTarget(target, source, request.isCurrent)
  } finally {
    if (request.isCurrent()) patchWorkspace({ routeOpenPending: false })
  }
}

export function cancelRouteFileOpen(): void {
  routeFileOpenRequests.invalidate()
  if (workspaceState().routeOpenPending) patchWorkspace({ routeOpenPending: false })
}

/** 首次启动或恢复目标失效时打开用户配置；最终回退 Home。 */
export async function openStartupTarget(transient = false): Promise<boolean> {
  const configured = readStartupTarget(
    typeof window === "undefined" ? undefined : window.localStorage,
  )
  if (configured.rootId) {
    const state = workspaceState()
    patchWorkspace({
      activeRootId: coerceCoreFileRootIdForMode(configured.rootId, state.mode, state.activeRootId),
    })
  }
  if (await openFileTarget({ type: "file", ...configured, transient }, "user")) return true
  if (
    configured.ref.fileSystemId === DEFAULT_STARTUP_TARGET.ref.fileSystemId &&
    configured.ref.fileId === DEFAULT_STARTUP_TARGET.ref.fileId &&
    configured.engineId === DEFAULT_STARTUP_TARGET.engineId
  ) {
    return false
  }
  patchWorkspace({ activeRootId: DEFAULT_STARTUP_TARGET.rootId ?? "home" })
  return openFileTarget(
    { type: "file", ...DEFAULT_STARTUP_TARGET, transient, rootId: "home" },
    "user",
  )
}

/** 统一打开入口：运行时只接受 File、规范标签或宿主命令。 */
export function openTarget(target: OpenTarget, source: ActiveSource = "user"): boolean {
  switch (target.type) {
    case "tab":
      openTab(target.descriptor, source, { transient: target.transient })
      return true
    case "file":
      void openFileTarget(target, source)
      return true
    case "command":
      invalidatePendingFileOpen()
      if (target.command === "open-ai-panel") setRightPanel(true)
      else toggleRightPanel()
      return true
  }
}

export function toggleFileRoot(rootId: string): void {
  invalidatePendingFileOpen()
  const state = workspaceState()
  const root = coreFileRoot(rootId)
  const mode = coreFileRootMode(root, state.mode)
  if (state.activeRootId === root.id && state.mode === mode && !state.sidebarCollapsed) {
    patchWorkspace({ sidebarCollapsed: true })
    return
  }
  patchWorkspace({
    activeRootId: root.id,
    activeModule: root.module,
    mode,
    sidebarCollapsed: false,
    activeSource: "user",
  })
  if (root.defaultFile) {
    void openFileTarget(
      { type: "file", ref: root.defaultFile, transient: true, rootId: root.id },
      "user",
    )
  }
}

export function toggleMountedFileRoot(ref: FileRef): void {
  invalidatePendingFileOpen()
  const state = workspaceState()
  const rootId = mountedFileRootId(ref)
  if (state.activeRootId === rootId && !state.sidebarCollapsed) {
    patchWorkspace({ sidebarCollapsed: true })
    return
  }
  patchWorkspace({
    activeRootId: rootId,
    activeModule: "home",
    sidebarCollapsed: false,
    activeSource: "user",
  })
  void openFileTarget({ type: "file", ref, transient: true, rootId }, "user")
}

export function toggleModule(moduleId: ModuleId): void {
  invalidatePendingFileOpen()
  const state = workspaceState()
  if (state.activeModule === moduleId && !state.sidebarCollapsed) {
    patchWorkspace({ sidebarCollapsed: true })
    return
  }
  const workspaceModule = moduleById(moduleId)
  const first = workspaceModule.entries[0]
  const mode = isModeNeutralModule(moduleId) ? state.mode : MODE_OF[moduleId]
  if (!first || moduleId === "plugins") {
    patchWorkspace({ activeModule: moduleId, mode, sidebarCollapsed: false })
    return
  }
  const descriptor = migrateWorkspaceTab({ ...first.descriptor, id: tabKey(first.descriptor) })
  if (!descriptor) {
    patchWorkspace({ activeModule: moduleId, mode, sidebarCollapsed: false })
    return
  }
  hideBrowserWebviewUnlessBrowserTab(descriptor)
  patchWorkspace({
    ...planTransientTabOpen(state.tabs, state.transientId, descriptor),
    activeModule: moduleId,
    activeRootId: coerceCoreFileRootIdForMode(
      descriptor.rootId ?? coreFileRootForModule(moduleId).id,
      mode,
    ),
    mode,
    sidebarCollapsed: false,
    activeSource: "user",
  })
}

/** 切换渲染工作区，为当前文件激活新场景的 Engine，同时保留已有 Engine 标签。 */
export function setWorkspaceKind(workspaceKind: WorkspaceKind): void {
  invalidatePendingFileOpen()
  const state = workspaceState()
  if (workspaceKind === state.workspaceKind) return
  const currentTab = state.tabs.find((tab) => tab.id === state.activeId)
  const currentFile = fileEngineTargetForTab(currentTab)
  const request = workspaceEngineOpenRequests.begin()
  patchWorkspace({ workspaceKind })
  if (!currentFile || !currentTab) return

  void openFileTarget(
    {
      type: "file",
      ref: currentFile.ref,
      title: currentTab.title,
      rootId: currentTab.rootId,
      transient: false,
    },
    "user",
    () =>
      request.isCurrent() &&
      workspaceState().workspaceKind === workspaceKind &&
      workspaceState().activeId === currentTab.id,
  )
}

export function setDevelopmentTool(developmentTool: DevelopmentTool): void {
  if (developmentTool !== workspaceState().developmentTool) patchWorkspace({ developmentTool })
}

export function setMode(mode: WsMode): void {
  invalidatePendingFileOpen()
  const state = workspaceState()
  if (mode === state.mode) {
    const activeModule = coerceActiveModuleForMode(state.activeModule, mode)
    const activeRootId = coerceCoreFileRootIdForMode(state.activeRootId, mode)
    if (activeModule !== state.activeModule || activeRootId !== state.activeRootId) {
      patchWorkspace({ activeModule, activeRootId })
    }
    return
  }

  cancelRouteFileOpen()
  const firstModule: ModuleId = mode === "local" ? "home" : "info"
  const first = moduleById(firstModule).entries[0]
  if (!first) {
    patchWorkspace({
      mode,
      activeModule: firstModule,
      sidebarCollapsed: false,
      activeSource: "user",
    })
    return
  }
  const descriptor = migrateWorkspaceTab({ ...first.descriptor, id: tabKey(first.descriptor) })
  if (!descriptor) {
    patchWorkspace({
      mode,
      activeModule: firstModule,
      sidebarCollapsed: false,
      activeSource: "user",
    })
    return
  }
  hideBrowserWebviewUnlessBrowserTab(descriptor)
  patchWorkspace({
    ...planTransientTabOpen(state.tabs, state.transientId, descriptor),
    mode,
    activeModule: firstModule,
    activeRootId: coerceCoreFileRootIdForMode(
      descriptor.rootId ?? coreFileRootForModule(firstModule).id,
      mode,
    ),
    sidebarCollapsed: false,
    activeSource: "user",
  })
}

export function setSidebarCollapsed(value: boolean): void {
  patchWorkspace({ sidebarCollapsed: value })
}

export function toggleSidebar(): void {
  patchWorkspace({ sidebarCollapsed: !workspaceState().sidebarCollapsed })
}

export function toggleWorkspace(): void {
  const state = workspaceState()
  if (state.activeModule === "agent" && !state.sidebarCollapsed) {
    patchWorkspace({ sidebarCollapsed: true })
    return
  }
  patchWorkspace({ activeModule: "agent", sidebarCollapsed: false, activeSource: "user" })
}

export function toggleRightPanel(): void {
  patchWorkspace({ rightPanelOpen: !workspaceState().rightPanelOpen })
}

export function setRightPanel(value: boolean): void {
  patchWorkspace({ rightPanelOpen: value })
}
