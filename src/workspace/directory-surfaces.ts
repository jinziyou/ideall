import { sameFileRef, type FileRef } from "@protocol/file-system"
import { INSTALLED_APPS_ROOT_REF } from "@/filesystem/builtin-app-roots"
import type { IdeallPath } from "@/filesystem/path"
import { corePlaceRef } from "@/filesystem/resource-file-system"
import { trashRootRef } from "@/filesystem/trash-file-system"
import type { ModuleId } from "./types"

export type DirectorySurfaceId =
  "subscriptions" | "bookmarks" | "resources" | "trash" | "installed-apps"

export type DirectorySurface = Readonly<{
  id: DirectorySurfaceId
  legacyPanelId: string
  ref: FileRef
  engineId: string
  module: ModuleId
  rootId: "home" | "activity" | "apps"
  navigationPath: IdeallPath
}>

/**
 * 目录 Display 的唯一规范表；运行态标签使用真实目录 FileRef + 语义 Engine。
 */
export const DIRECTORY_SURFACES: readonly DirectorySurface[] = [
  {
    id: "subscriptions",
    legacyPanelId: "subscriptions",
    ref: corePlaceRef("subscriptions"),
    engineId: "ideall.subscriptions",
    module: "subscriptions",
    rootId: "home",
    navigationPath: "/home/following",
  },
  {
    id: "bookmarks",
    legacyPanelId: "bookmarks",
    ref: corePlaceRef("bookmarks"),
    engineId: "ideall.bookmarks",
    module: "home",
    rootId: "home",
    navigationPath: "/home/bookmarks",
  },
  {
    id: "resources",
    legacyPanelId: "files",
    ref: corePlaceRef("files"),
    engineId: "ideall.resources",
    module: "home",
    rootId: "home",
    navigationPath: "/home/resources",
  },
  {
    id: "trash",
    legacyPanelId: "trash",
    ref: trashRootRef,
    engineId: "ideall.trash",
    module: "trash",
    rootId: "activity",
    navigationPath: "/activity/deleted",
  },
  {
    id: "installed-apps",
    legacyPanelId: "apps",
    ref: INSTALLED_APPS_ROOT_REF,
    engineId: "ideall.installed-apps",
    module: "apps",
    rootId: "apps",
    navigationPath: "/apps/local-apps",
  },
] as const

export function directorySurfaceForRef(ref: FileRef): DirectorySurface | null {
  return DIRECTORY_SURFACES.find((surface) => sameFileRef(surface.ref, ref)) ?? null
}

export function directorySurface(id: DirectorySurfaceId): DirectorySurface {
  const surface = DIRECTORY_SURFACES.find((candidate) => candidate.id === id)
  if (!surface) throw new Error(`Unknown directory surface: ${id}`)
  return surface
}

export function directorySurfaceForLegacyPanel(ref: FileRef): DirectorySurface | null {
  if (ref.fileSystemId !== "ideall.core" || !ref.fileId.startsWith("panel:")) return null
  const panelId = ref.fileId.slice("panel:".length)
  return DIRECTORY_SURFACES.find((surface) => surface.legacyPanelId === panelId) ?? null
}

function isPathAtOrBelow(pathname: string, path: IdeallPath): boolean {
  return pathname === path || pathname.startsWith(`${path}/`)
}

export function directorySurfaceForPath(pathname: string): DirectorySurface | null {
  return (
    DIRECTORY_SURFACES.find((surface) => isPathAtOrBelow(pathname, surface.navigationPath)) ?? null
  )
}
