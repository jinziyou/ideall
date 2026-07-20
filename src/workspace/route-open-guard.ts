import { sameFileRef, type FileRef } from "@protocol/file-system"
import { fileEngineTargetForTab } from "./file-tab"
import { migrateWorkspaceTab } from "./workspace-compat"
import { tabKey } from "./tab-key"
import type { Tab, TabDescriptor } from "./types"

export type RouteFileIdentity = Readonly<{
  ref: FileRef
  engineId?: string
  navigationPath?: string
}>

/** Internal URL mirroring must not reopen the File + Engine tab that is already active. */
export function activeTabMatchesRouteFile(
  activeTab: Tab | null | undefined,
  target: RouteFileIdentity,
): boolean {
  if (!activeTab) return false
  const activeTarget = fileEngineTargetForTab(activeTab)
  if (!activeTarget || !sameFileRef(activeTarget.ref, target.ref)) return false
  if (target.engineId && activeTarget.engineId !== target.engineId) return false
  return !target.navigationPath || activeTab.navigationPath === target.navigationPath
}

/** Static/legacy route descriptors are compared after the same compatibility migration as openTab. */
export function activeTabMatchesRouteDescriptor(
  activeTab: Tab | null | undefined,
  descriptor: TabDescriptor,
): boolean {
  if (!activeTab) return false
  const migrated = migrateWorkspaceTab({ ...descriptor, id: tabKey(descriptor) })
  return activeTab.id === tabKey(migrated ?? descriptor)
}
