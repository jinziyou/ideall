"use client"

import type { DevelopmentTool, ModuleId, WorkspaceKind } from "../types"
import type { OpenTarget } from "../open-target"
import type { ActiveSource } from "../workspace-slice"
import { tabKey } from "../tab-key"
import { moduleById } from "../modules"
import {
  builtinAppSurfaceForRoot,
  builtinAppSurfaceForLegacyPanel,
  coreFileRoot,
  coreFileRootForModule,
  isCoreFileRootId,
  normalizeNavigationRootId,
} from "../file-roots"
import { FILE_ENGINE_TAB_KIND, fileEngineTab, fileEngineTargetForTab } from "../file-tab"
import { DEFAULT_STARTUP_TARGET, readStartupTarget } from "../startup-target"
import { canOpenStandaloneWindow } from "../standalone-window-policy"
import { resolveWorkspaceEngine } from "../workspace-engine"
import { inferredRootIdForFile, migrateWorkspaceTab } from "../workspace-compat"
import {
  directorySurfaceForLegacyPanel,
  directorySurfaceForPath,
  directorySurfaceForRef,
} from "../directory-surfaces"
import {
  capabilitySurface,
  capabilitySurfaceForLegacyPanel,
  capabilitySurfaceForPath,
  capabilitySurfaceForRef,
} from "../capability-surfaces"
import { planTransientTabOpen } from "../tab-lifecycle"
import { getFileSystem, statFile, subscribeFileSystems } from "@/filesystem/registry"
import { directoryEntryPreferredEngine } from "@/filesystem/directory-entry"
import { ideallPathSegments, resolveIdeallPath, type IdeallPath } from "@/filesystem/path"
import { aiTasksPanelFileRef, panelFileRef } from "@/filesystem/resource-file-system"
import { engineRegistry } from "@/engines/builtin"
import { enginePreferencesStorageKey, readEnginePreferences } from "@/engines/preferences"
import { openEngineWindow } from "@/lib/engine-window"
import { fileRefKey, sameFileRef, type FileRef } from "@protocol/file-system"
import { activateAgentWorkspaceBeforeOpen } from "../agent-workspace-navigation"
import { openTab, type OpenTabOptions } from "./tab-lifecycle"
import {
  fileOpenRequests,
  hideBrowserWebviewUnlessBrowserTab,
  invalidatePendingFileOpen,
  patchWorkspace,
  pathOpenRequests,
  routeFileOpenRequests,
  workspaceEngineOpenRequests,
  workspaceState,
} from "./runtime"

export function openSettings(): void {
  const surface = capabilitySurface("settings")
  openTarget({ type: "path", path: surface.navigationPath, rootId: surface.rootId })
}

export function openAiSettings(options?: OpenTabOptions): void {
  const surface = capabilitySurface("agent-settings")
  patchWorkspace({ activeModule: "agent", sidebarCollapsed: true })
  openTarget({
    type: "path",
    path: surface.navigationPath,
    rootId: surface.rootId,
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
    rootId: "settings",
    transient: options?.transient,
  })
}

export function openAiTasks(workspaceId: string, title: string, options?: OpenTabOptions): void {
  const ref = aiTasksPanelFileRef(workspaceId)
  patchWorkspace({ activeModule: "agent", sidebarCollapsed: true })
  void activateAgentWorkspaceBeforeOpen(workspaceId, () => {
    openTarget({
      type: "file",
      ref,
      title,
      rootId: "activity",
      transient: options?.transient,
    })
  })
}

/** 随包 runtime mount 在 BootGate 返回后的微任务中原子安装；给旧启动目标/极早点击一次短暂等待。 */
function waitForFileSystem(fileSystemId: string, timeoutMs = 500): Promise<boolean> {
  if (getFileSystem(fileSystemId)) return Promise.resolve(true)
  return new Promise((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let unsubscribe = () => {}
    const finish = (available: boolean) => {
      if (settled) return
      settled = true
      unsubscribe()
      if (timer) clearTimeout(timer)
      resolve(available)
    }
    unsubscribe = subscribeFileSystems(() => {
      if (getFileSystem(fileSystemId)) finish(true)
    })
    timer = setTimeout(() => finish(false), timeoutMs)
    if (getFileSystem(fileSystemId)) finish(true)
  })
}

async function openFileTarget(
  target: Extract<OpenTarget, { type: "file" }>,
  source: ActiveSource,
  shouldCommit?: () => boolean,
  preservePathRequest = false,
): Promise<boolean> {
  if (!preservePathRequest) pathOpenRequests.invalidate()
  const legacyDirectorySurface = directorySurfaceForLegacyPanel(target.ref)
  if (legacyDirectorySurface) {
    target = {
      ...target,
      ref: legacyDirectorySurface.ref,
      file: undefined,
      engineId: legacyDirectorySurface.engineId,
      rootId: legacyDirectorySurface.rootId,
      navigationPath: target.navigationPath ?? legacyDirectorySurface.navigationPath,
    }
  }
  const legacyCapabilitySurface = capabilitySurfaceForLegacyPanel(target.ref)
  if (legacyCapabilitySurface) {
    target = {
      ...target,
      ref: legacyCapabilitySurface.ref,
      file: undefined,
      engineId: legacyCapabilitySurface.engineId,
      rootId: legacyCapabilitySurface.rootId,
      navigationPath: target.navigationPath ?? legacyCapabilitySurface.navigationPath,
    }
  }
  const legacySurface = builtinAppSurfaceForLegacyPanel(target.ref)
  if (legacySurface) {
    target = {
      ...target,
      ref: legacySurface.ref,
      file: undefined,
      engineId: legacySurface.engineId,
      rootId: "apps",
    }
  }

  const request = fileOpenRequests.begin()
  const canCommit = () => request.isCurrent() && (shouldCommit?.() ?? true)
  const navigationRootId = target.rootId ? normalizeNavigationRootId(target.rootId) : undefined
  if (navigationRootId) patchWorkspace({ activeRootId: navigationRootId })

  try {
    const directorySurface = directorySurfaceForRef(target.ref)
    const capabilitySurface = capabilitySurfaceForRef(target.ref)
    const semanticSurface = directorySurface ?? capabilitySurface
    if (semanticSurface && !(await waitForFileSystem(semanticSurface.ref.fileSystemId))) {
      return false
    }
    if (!canCommit()) return false
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
    const requestedRootId = target.rootId ?? existingRootId ?? inferredRootIdForFile(file.ref)
    const rootId = requestedRootId ? normalizeNavigationRootId(requestedRootId) : undefined
    const canonicalSurface = semanticSurface?.engineId === engineId ? semanticSurface : null
    const navigationPath = target.navigationPath ?? canonicalSurface?.navigationPath
    openTab(
      fileEngineTab({ ref: file.ref, name: target.title || file.name }, engineId, {
        ...(rootId ? { rootId } : {}),
        ...(canonicalSurface ? { path: canonicalSurface.navigationPath } : {}),
        ...(navigationPath ? { navigationPath } : {}),
      }),
      source,
      { transient: target.transient },
    )
    if (rootId) {
      patchWorkspace({ activeRootId: rootId })
    }
    return true
  } catch {
    return false
  }
}

async function openPathTarget(
  target: Extract<OpenTarget, { type: "path" }>,
  source: ActiveSource,
): Promise<boolean> {
  const request = pathOpenRequests.begin()
  try {
    const pathSegments = ideallPathSegments(target.path)
    const isNavigationRoot = pathSegments.length === 1 && isCoreFileRootId(pathSegments[0]!)
    const semanticSurface =
      !isNavigationRoot &&
      (directorySurfaceForPath(target.path) ?? capabilitySurfaceForPath(target.path))
    if (semanticSurface && !(await waitForFileSystem(semanticSurface.ref.fileSystemId))) {
      return false
    }
    if (!request.isCurrent()) return false
    const resolved = await resolveIdeallPath(target.path, {
      actor: "ui",
      permissions: [],
      intent: "metadata",
    })
    if (!resolved || !request.isCurrent()) return false
    const link = resolved.entries.at(-1)
    const pathRoot = pathSegments[0]
    const rootId = target.rootId ?? (pathRoot ? normalizeNavigationRootId(pathRoot) : undefined)
    return await openFileTarget(
      {
        type: "file",
        ref: resolved.ref,
        file: resolved.file,
        engineId: target.engineId ?? directoryEntryPreferredEngine(link),
        title: target.title ?? link?.name ?? resolved.file.name,
        transient: target.transient,
        display: target.display,
        rootId,
        navigationPath: resolved.path,
      },
      source,
      request.isCurrent,
      true,
    )
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
    patchWorkspace({ activeRootId: normalizeNavigationRootId(configured.rootId) })
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
    case "path":
      void openPathTarget(target, source)
      return true
    case "command":
      invalidatePendingFileOpen()
      if (target.command === "open-ai-panel") setRightPanel(true)
      else toggleRightPanel()
      return true
  }
}

export function toggleFileRoot(rootId: string, path?: IdeallPath): void {
  invalidatePendingFileOpen()
  const state = workspaceState()
  const root = coreFileRoot(rootId)
  if (state.activeRootId === root.id && !state.sidebarCollapsed) {
    patchWorkspace({ sidebarCollapsed: true })
    return
  }
  patchWorkspace({
    activeRootId: root.id,
    activeModule: root.module,
    sidebarCollapsed: false,
    activeSource: "user",
  })
  void openPathTarget(
    { type: "path", path: path ?? root.defaultPath, transient: true, rootId: root.id },
    "user",
  )
}

export function toggleMountedFileRoot(ref: FileRef): void {
  invalidatePendingFileOpen()
  const rootId = "apps"
  patchWorkspace({
    activeRootId: rootId,
    activeModule: builtinAppSurfaceForRoot(ref)?.module ?? "apps",
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
  if (!first || moduleId === "plugins") {
    patchWorkspace({
      activeModule: moduleId,
      activeRootId: coreFileRootForModule(moduleId).id,
      sidebarCollapsed: false,
    })
    return
  }
  const descriptor = migrateWorkspaceTab({ ...first.descriptor, id: tabKey(first.descriptor) })
  if (!descriptor) {
    patchWorkspace({
      activeModule: moduleId,
      activeRootId: coreFileRootForModule(moduleId).id,
      sidebarCollapsed: false,
    })
    return
  }
  hideBrowserWebviewUnlessBrowserTab(descriptor)
  patchWorkspace({
    ...planTransientTabOpen(state.tabs, state.transientId, descriptor),
    activeModule: moduleId,
    activeRootId: normalizeNavigationRootId(
      descriptor.rootId ?? coreFileRootForModule(moduleId).id,
    ),
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

export function setSidebarCollapsed(value: boolean): void {
  patchWorkspace({ sidebarCollapsed: value })
}

export function toggleSidebar(): void {
  patchWorkspace({ sidebarCollapsed: !workspaceState().sidebarCollapsed })
}

export function toggleWorkspace(): void {
  const state = workspaceState()
  if (state.activeRootId === "activity" && !state.sidebarCollapsed) {
    patchWorkspace({ sidebarCollapsed: true })
    return
  }
  patchWorkspace({
    activeModule: "agent",
    activeRootId: "activity",
    sidebarCollapsed: false,
    activeSource: "user",
  })
}

export function toggleRightPanel(): void {
  patchWorkspace({ rightPanelOpen: !workspaceState().rightPanelOpen })
}

export function setRightPanel(value: boolean): void {
  patchWorkspace({ rightPanelOpen: value })
}
