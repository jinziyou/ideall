import {
  fileRefKey,
  parseFileRefKey,
  parseFileRefSearch,
  type FileRef,
  type IdeallFile,
} from "@protocol/file-system"
import { panelForFile, resourceRefForFile } from "@/filesystem/resource-file-system"
import type { ModuleId, Tab, TabDescriptor } from "./types"
import { moduleForResource } from "./resource-tab"
import { builtinAppSurfaceForRoot, coreFileRootForRef } from "./file-roots"
import { directorySurfaceForRef } from "./directory-surfaces"
import { capabilitySurfaceForRef } from "./capability-surfaces"

export const FILE_ENGINE_TAB_KIND = "file-engine"

export type FileEngineTabTarget = {
  ref: FileRef
  engineId: string
}

function moduleForFile(ref: FileRef): ModuleId {
  const navigationRoot = coreFileRootForRef(ref)
  if (navigationRoot) return navigationRoot.module
  const resource = resourceRefForFile(ref)
  if (resource) return moduleForResource(resource)
  const panel = panelForFile(ref)
  if (panel) return panel.module as ModuleId
  const appSurface = builtinAppSurfaceForRoot(ref)
  if (appSurface) return appSurface.module
  const capabilitySurface = capabilitySurfaceForRef(ref)
  if (capabilitySurface) return capabilitySurface.module
  const directorySurface = directorySurfaceForRef(ref)
  if (directorySurface) return directorySurface.module
  return "home"
}

export function fileEnginePath(ref: FileRef, engineId: string): string {
  const params = new URLSearchParams()
  params.set("file", fileRefKey(ref))
  params.set("engine", engineId)
  return `/home?${params.toString()}`
}

export function fileEngineTab(
  file: Pick<IdeallFile, "ref" | "name">,
  engineId: string,
  overrides: Partial<Omit<TabDescriptor, "kind" | "params">> = {},
): TabDescriptor {
  return {
    kind: FILE_ENGINE_TAB_KIND,
    module: moduleForFile(file.ref),
    title: file.name,
    path: fileEnginePath(file.ref, engineId),
    ...overrides,
    params: { file: fileRefKey(file.ref), engine: engineId },
  }
}

export function parseFileEngineTabParams(
  params?: Record<string, string>,
): FileEngineTabTarget | null {
  const ref = parseFileRefKey(params?.file)
  const engineId = params?.engine?.trim()
  return ref && engineId ? { ref, engineId } : null
}

export function parseFileEngineSearch(search: string): FileEngineTabTarget | null {
  const ref = parseFileRefSearch(search)
  if (!ref) return null
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
  const engineId = params.get("engine")?.trim()
  return engineId ? { ref, engineId } : null
}

export function descriptorForFileEngineSearch(search: string): TabDescriptor | null {
  const target = parseFileEngineSearch(search)
  return target
    ? fileEngineTab({ ref: target.ref, name: target.ref.fileId }, target.engineId)
    : null
}

export function fileEngineTargetForTab(
  tab: Pick<Tab, "kind" | "params"> | null | undefined,
): FileEngineTabTarget | null {
  return tab?.kind === FILE_ENGINE_TAB_KIND ? parseFileEngineTabParams(tab.params) : null
}
