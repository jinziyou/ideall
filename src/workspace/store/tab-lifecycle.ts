"use client"

import type { Tab, TabDescriptor } from "../types"
import type { NodeRef } from "../node-ref"
import { tabKey } from "../tab-key"
import { isBrowserResourceTab, nodeResourceRefForTab } from "../resource-tab"
import { isStaticTabKind } from "../tab-definitions"
import { coreFileRootForModule, normalizeNavigationRootId } from "../file-roots"
import { FILE_ENGINE_TAB_KIND, fileEngineTargetForTab } from "../file-tab"
import { migrateWorkspaceTab } from "../workspace-compat"
import {
  dirtyTabClosePolicy,
  evictColdTabs,
  planTabClose,
  planTransientTabOpen,
} from "../tab-lifecycle"
import { fileRefKey, type FileRef } from "@protocol/file-system"
import { resourceRefForFile } from "@/filesystem/resource-file-system"
import { browserRelease, isTauri } from "@/lib/tauri"
import {
  dirtyTabSet,
  hideBrowserWebviewUnlessBrowserTab,
  invalidatePendingFileOpen,
  patchWorkspace,
  workspaceState,
} from "./runtime"

export type OpenTabOptions = { transient?: boolean }

/**
 * 打开或激活标签；瞬态标签复用唯一预览槽。
 */
export function openTab(
  descriptor: TabDescriptor,
  source: import("../workspace-slice").ActiveSource = "user",
  options?: OpenTabOptions,
): void {
  invalidatePendingFileOpen()
  // 兼容旧调用者交出的 descriptor；最终标签身份仍由 FileRef + Engine 决定。
  if (descriptor.kind === "resource") {
    const migrated = migrateWorkspaceTab({ ...descriptor, id: tabKey(descriptor) })
    if (migrated?.kind === FILE_ENGINE_TAB_KIND) {
      openTab(migrated, source, options)
      return
    }
  }
  if (isStaticTabKind(descriptor.kind)) {
    const migrated = migrateWorkspaceTab({ ...descriptor, id: tabKey(descriptor) })
    if (migrated?.kind === FILE_ENGINE_TAB_KIND) {
      openTab(migrated, source, options)
      return
    }
  }

  hideBrowserWebviewUnlessBrowserTab(descriptor)
  const id = tabKey(descriptor)
  const state = workspaceState()
  const activeRootId = normalizeNavigationRootId(
    descriptor.rootId ?? coreFileRootForModule(descriptor.module).id,
  )
  const canonicalDescriptor = { ...descriptor, rootId: activeRootId }
  if (options?.transient) {
    const plan = planTransientTabOpen(state.tabs, state.transientId, canonicalDescriptor)
    patchWorkspace({
      ...plan,
      tabs: plan.tabs.map((tab) =>
        tab.id === plan.activeId ? { ...tab, rootId: activeRootId } : tab,
      ),
      activeModule: descriptor.module,
      activeRootId,
      activeSource: source,
    })
    return
  }

  const exists = state.tabs.some((tab) => tab.id === id)
  const tabs = exists
    ? state.tabs.map((tab) => (tab.id === id ? { ...tab, rootId: activeRootId } : tab))
    : evictColdTabs({
        tabs: [...state.tabs, { ...canonicalDescriptor, id }],
        transientId: state.transientId,
        lru: state.lru,
        dirtyIds: dirtyTabSet(),
        protectedIds: new Set([id]),
      })
  patchWorkspace({
    tabs,
    transientId: state.transientId === id ? null : state.transientId,
    activeId: id,
    activeModule: descriptor.module,
    activeRootId,
    activeSource: source,
  })
}

/** 把当前预览标签提升为常驻。 */
export function promoteTab(id: string): void {
  if (workspaceState().transientId !== id) return
  patchWorkspace({ transientId: null })
}

export function promoteActiveTab(): void {
  const { activeId, transientId } = workspaceState()
  if (activeId && activeId === transientId) patchWorkspace({ transientId: null })
}

/** 节点取数后回填真实标题，不改变标签身份。 */
export function renameNodeTab(ref: NodeRef, title: string): void {
  const matches = (tab: Tab) => {
    const legacy = nodeResourceRefForTab(tab)
    if (legacy?.kind === ref.kind && legacy.id === ref.id) return true
    const fileTarget = fileEngineTargetForTab(tab)
    const resource = fileTarget ? resourceRefForFile(fileTarget.ref) : null
    return resource?.scheme === "node" && resource.kind === ref.kind && resource.id === ref.id
  }
  const state = workspaceState()
  if (!state.tabs.some(matches)) return
  patchWorkspace({ tabs: state.tabs.map((tab) => (matches(tab) ? { ...tab, title } : tab)) })
}

/** 删除节点后关闭它的全部引擎视图及水合遗留的兼容标签。 */
export function closeNodeTabs(ref: NodeRef): void {
  const ids = workspaceState().tabs.flatMap((tab) => {
    const legacy = nodeResourceRefForTab(tab)
    const fileTarget = fileEngineTargetForTab(tab)
    const resource = fileTarget ? resourceRefForFile(fileTarget.ref) : null
    return (legacy?.kind === ref.kind && legacy.id === ref.id) ||
      (resource?.scheme === "node" && resource.kind === ref.kind && resource.id === ref.id)
      ? [tab.id]
      : []
  })
  for (const id of ids) closeTab(id)
}

/** 关闭同一文件通过任意引擎打开的全部 Display。 */
export function closeFileTabs(ref: FileRef): void {
  const key = fileRefKey(ref)
  const ids = workspaceState().tabs.flatMap((tab) => {
    const target = fileEngineTargetForTab(tab)
    return target && fileRefKey(target.ref) === key ? [tab.id] : []
  })
  for (const id of ids) closeTab(id)
}

export function setTabDirty(id: string, dirty: boolean): void {
  const state = workspaceState()
  if (!state.tabs.some((tab) => tab.id === id)) return
  const next = dirtyTabSet()
  if (dirty) next.add(id)
  else next.delete(id)
  const dirtyTabs = [...next]
  if (
    dirtyTabs.length === state.dirtyTabs.length &&
    dirtyTabs.every((value, index) => value === state.dirtyTabs[index])
  ) {
    return
  }
  patchWorkspace({ dirtyTabs })
}

/** Renderer 仅在完整快照成功写入有界会话存储后设置 true。 */
export function setTabSuspendReady(id: string, ready: boolean): void {
  const state = workspaceState()
  if (!state.tabs.some((tab) => tab.id === id)) return
  const next = new Set(state.suspendReadyTabs)
  if (ready) next.add(id)
  else next.delete(id)
  const suspendReadyTabs = [...next]
  if (
    suspendReadyTabs.length === state.suspendReadyTabs.length &&
    suspendReadyTabs.every((value, index) => value === state.suspendReadyTabs[index])
  ) {
    return
  }
  patchWorkspace({ suspendReadyTabs })
}

export function isTabDirty(id: string): boolean {
  return workspaceState().dirtyTabs.includes(id)
}

export type DirtyTabCloseRequest = {
  title: string
  description: string
  confirmLabel: string
  ids: string[]
  confirm: () => void
}

const dirtyTabCloseListeners = new Set<(request: DirtyTabCloseRequest) => void>()

export function subscribeDirtyTabCloseRequests(
  listener: (request: DirtyTabCloseRequest) => void,
): () => void {
  dirtyTabCloseListeners.add(listener)
  return () => dirtyTabCloseListeners.delete(listener)
}

function requestDirtyClose(ids: string[], confirm: () => void): boolean {
  const request = dirtyTabClosePolicy(workspaceState().tabs, dirtyTabSet(), ids)
  if (!request) return true
  for (const listener of dirtyTabCloseListeners) listener({ ...request, confirm })
  return false
}

/** 关闭标签；若关闭活动项，焦点转移到相邻标签。 */
export function closeTab(id: string): void {
  invalidatePendingFileOpen()
  const state = workspaceState()
  const plan = planTabClose(state.tabs, state.activeId, state.transientId, id)
  if (!plan) return
  if (isBrowserResourceTab(plan.closingTab) && isTauri()) {
    void browserRelease().catch(() => {})
  }
  let activeModule = state.activeModule
  let activeRootId = state.activeRootId
  if (plan.activeChanged && plan.nextActiveTab) {
    const next = plan.nextActiveTab
    hideBrowserWebviewUnlessBrowserTab(next)
    activeModule = next.module
    activeRootId = normalizeNavigationRootId(next.rootId ?? coreFileRootForModule(next.module).id)
  }
  patchWorkspace({
    tabs: plan.tabs,
    activeId: plan.activeId,
    activeModule,
    activeRootId,
    transientId: plan.transientId,
    activeSource: "user",
  })
}

export function requestCloseTab(id: string): boolean {
  if (!requestDirtyClose([id], () => closeTab(id))) return false
  closeTab(id)
  return true
}

export function closeAllTabs(): void {
  invalidatePendingFileOpen()
  if (workspaceState().tabs.length === 0) return
  if (isTauri()) void browserRelease().catch(() => {})
  patchWorkspace({ tabs: [], activeId: null, transientId: null, activeSource: "user" })
}

export function requestCloseAllTabs(): boolean {
  if (
    !requestDirtyClose(
      workspaceState().tabs.map((tab) => tab.id),
      closeAllTabs,
    )
  )
    return false
  closeAllTabs()
  return true
}

export function closeOtherTabs(keepId: string): void {
  invalidatePendingFileOpen()
  const state = workspaceState()
  const keep = state.tabs.find((tab) => tab.id === keepId)
  if (!keep) return
  hideBrowserWebviewUnlessBrowserTab(keep)
  patchWorkspace({
    tabs: [keep],
    activeId: keepId,
    activeModule: keep.module,
    activeRootId: normalizeNavigationRootId(keep.rootId ?? coreFileRootForModule(keep.module).id),
    transientId: state.transientId === keepId ? keepId : null,
    activeSource: "user",
  })
}

export function requestCloseOtherTabs(keepId: string): boolean {
  const ids = workspaceState()
    .tabs.filter((tab) => tab.id !== keepId)
    .map((tab) => tab.id)
  if (!requestDirtyClose(ids, () => closeOtherTabs(keepId))) return false
  closeOtherTabs(keepId)
  return true
}

export function setActiveTab(id: string): void {
  invalidatePendingFileOpen()
  const state = workspaceState()
  const tab = state.tabs.find((candidate) => candidate.id === id)
  if (!tab) return
  hideBrowserWebviewUnlessBrowserTab(tab)
  patchWorkspace({
    activeId: id,
    activeModule: tab.module,
    activeRootId: normalizeNavigationRootId(tab.rootId ?? coreFileRootForModule(tab.module).id),
    activeSource: "user",
  })
}

export function reorderTabs(fromId: string, toId: string): void {
  const state = workspaceState()
  const from = state.tabs.findIndex((tab) => tab.id === fromId)
  const to = state.tabs.findIndex((tab) => tab.id === toId)
  if (from === -1 || to === -1 || from === to) return
  const tabs = [...state.tabs]
  const [moved] = tabs.splice(from, 1)
  if (!moved) return
  tabs.splice(to, 0, moved)
  patchWorkspace({ tabs })
}

export function closeActiveTab(): void {
  const id = workspaceState().activeId
  if (id) closeTab(id)
}

export function requestCloseActiveTab(): boolean {
  const id = workspaceState().activeId
  return id ? requestCloseTab(id) : true
}

export function activateAdjacentTab(delta: 1 | -1): void {
  const state = workspaceState()
  const count = state.tabs.length
  if (count === 0) return
  const current = state.tabs.findIndex((tab) => tab.id === state.activeId)
  const next = state.tabs[(current === -1 ? 0 : current + delta + count) % count]
  if (next) setActiveTab(next.id)
}

export function activateTabAt(index: number): void {
  const tabs = workspaceState().tabs
  if (tabs.length === 0 || index < 1) return
  const tab = index >= 9 ? tabs[tabs.length - 1] : tabs[index - 1]
  if (tab) setActiveTab(tab.id)
}
