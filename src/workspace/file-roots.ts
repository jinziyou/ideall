import type { ComponentType } from "react"
import { fileRefKey, parseFileRefKey, type FileRef } from "@protocol/file-system"
import type { ResourceRef } from "@protocol/resource"
import type { ModuleId } from "./types"
import { corePlaceRef, panelFileRef, resourceFileRef } from "@/filesystem/resource-file-system"
import {
  AUDIO_LIBRARY_ROOT_REF,
  DATABASE_ROOT_REF,
  GIT_ROOT_REF,
} from "@/filesystem/builtin-app-roots"
import {
  NAVIGATION_SECTIONS,
  navigationSectionIdForRoot,
  type NavigationSectionId,
} from "./navigation-sections"

/**
 * 五个固定导航分区。旧的细粒度文件根仍保留稳定 FileRef，但不再作为一级入口。
 */
export type CoreFileRootId = NavigationSectionId

export type CoreFileRoot = {
  id: CoreFileRootId
  label: string
  sidebarTitle: string
  icon: ComponentType<{ className?: string }>
  module: ModuleId
  colorClass?: string
  defaultFile?: FileRef
}

const resource = (ref: ResourceRef) => resourceFileRef(ref)

export type BuiltinAppSurfaceId = "audio" | "database" | "git"

export const BUILTIN_APP_SURFACES: Readonly<
  Record<BuiltinAppSurfaceId, Readonly<{ ref: FileRef; engineId: string; module: ModuleId }>>
> = {
  audio: { ref: AUDIO_LIBRARY_ROOT_REF, engineId: "ideall.audio", module: "audio" },
  database: { ref: DATABASE_ROOT_REF, engineId: "ideall.database", module: "database" },
  git: { ref: GIT_ROOT_REF, engineId: "ideall.git", module: "git" },
}

export function builtinAppSurfaceForRoot(
  ref: FileRef,
): (typeof BUILTIN_APP_SURFACES)[BuiltinAppSurfaceId] | null {
  return (
    Object.values(BUILTIN_APP_SURFACES).find(
      (surface) =>
        surface.ref.fileSystemId === ref.fileSystemId && surface.ref.fileId === ref.fileId,
    ) ?? null
  )
}

/** 旧 ideall.core/panel:* 仅作为入口别名；新标签身份永远使用 App FileSystem root。 */
export function builtinAppSurfaceForLegacyPanel(
  ref: FileRef,
): (typeof BUILTIN_APP_SURFACES)[BuiltinAppSurfaceId] | null {
  if (ref.fileSystemId !== "ideall.core" || !ref.fileId.startsWith("panel:")) return null
  const id = ref.fileId.slice("panel:".length)
  return id === "audio" || id === "database" || id === "git" ? BUILTIN_APP_SURFACES[id] : null
}

const SECTION_MODULE: Readonly<Record<CoreFileRootId, ModuleId>> = {
  home: "home",
  activity: "agent",
  browse: "info",
  apps: "apps",
  settings: "home",
}

export const CORE_FILE_ROOTS: readonly CoreFileRoot[] = NAVIGATION_SECTIONS.map((section) => ({
  id: section.id,
  label: section.label,
  sidebarTitle: section.label,
  icon: section.icon,
  module: SECTION_MODULE[section.id],
  colorClass: section.colorClass,
  defaultFile: section.items[0]?.target.ref,
}))

export const MOUNTED_FILE_ROOT_PREFIX = "mount:"

export function isCoreFileRootId(value: string): value is CoreFileRootId {
  return CORE_FILE_ROOTS.some((root) => root.id === value)
}

export function normalizeNavigationRootId(rootId: string | null | undefined): CoreFileRootId {
  return navigationSectionIdForRoot(rootId)
}

export function mountedFileRootId(ref: FileRef): string {
  return `${MOUNTED_FILE_ROOT_PREFIX}${fileRefKey(ref)}`
}

export function fileRootRef(rootId: string): FileRef | null {
  if (isCoreFileRootId(rootId)) {
    const representative = {
      home: "home",
      activity: "workspace",
      browse: "info",
      apps: "apps",
      settings: "system",
    } as const
    return corePlaceRef(representative[rootId])
  }
  return rootId.startsWith(MOUNTED_FILE_ROOT_PREFIX)
    ? parseFileRefKey(rootId.slice(MOUNTED_FILE_ROOT_PREFIX.length))
    : null
}

export function defaultFileForPath(pathname: string): { ref: FileRef; rootId: string } | null {
  if (pathname.startsWith("/home/settings")) {
    return { ref: panelFileRef("settings"), rootId: "settings" }
  }
  if (pathname.startsWith("/home/subscriptions")) {
    return { ref: panelFileRef("subscriptions"), rootId: "home" }
  }
  if (pathname.startsWith("/home/publications")) {
    return { ref: panelFileRef("publications"), rootId: "browse" }
  }
  if (pathname.startsWith("/home/bookmarks")) {
    return { ref: panelFileRef("bookmarks"), rootId: "home" }
  }
  if (pathname.startsWith("/home/resources")) {
    return { ref: panelFileRef("files"), rootId: "home" }
  }
  if (pathname.startsWith("/home/notes")) {
    return { ref: panelFileRef("notes"), rootId: "home" }
  }
  if (pathname.startsWith("/apps")) return { ref: panelFileRef("apps"), rootId: "apps" }
  if (pathname.startsWith("/info")) {
    return { ref: resource({ scheme: "info", kind: "home", id: "default" }), rootId: "browse" }
  }
  if (pathname.startsWith("/community")) {
    return {
      ref: resource({ scheme: "community", kind: "home", id: "default" }),
      rootId: "browse",
    }
  }
  if (pathname.startsWith("/browser")) {
    return {
      ref: resource({ scheme: "browser", kind: "page", id: "default" }),
      rootId: "browse",
    }
  }
  if (pathname.startsWith("/tool/ai")) {
    return { ref: resource({ scheme: "tool", kind: "ai", id: "default" }), rootId: "apps" }
  }
  if (pathname.startsWith("/tool/navigation")) {
    return {
      ref: resource({ scheme: "tool", kind: "navigation", id: "default" }),
      rootId: "apps",
    }
  }
  if (pathname.startsWith("/tool")) {
    return { ref: resource({ scheme: "tool", kind: "search", id: "default" }), rootId: "apps" }
  }
  for (const id of ["audio", "database", "git"] as const) {
    if (pathname.startsWith(`/${id}`)) {
      const surface = BUILTIN_APP_SURFACES[id]
      return { ref: surface.ref, rootId: "apps" }
    }
  }
  const systemPanel = (["shell", "code", "trash"] as const).find((id) =>
    pathname.startsWith(`/${id}`),
  )
  return systemPanel
    ? { ref: panelFileRef(systemPanel), rootId: systemPanel === "trash" ? "activity" : "apps" }
    : null
}

export function coreFileRoot(id: string | null | undefined): CoreFileRoot {
  const normalized = normalizeNavigationRootId(id)
  return CORE_FILE_ROOTS.find((root) => root.id === normalized) ?? CORE_FILE_ROOTS[0]
}

export function coreFileRootForModule(module: ModuleId): CoreFileRoot {
  if (module === "subscriptions") return coreFileRoot("home")
  if (module === "apps") return coreFileRoot("apps")
  if (["info", "community", "publications", "browser"].includes(module)) {
    return coreFileRoot("browse")
  }
  if (module === "tool") return coreFileRoot("apps")
  if (module === "agent" || module === "trash") return coreFileRoot("activity")
  if (["shell", "git", "database", "audio", "code", "trash", "plugins"].includes(module)) {
    return coreFileRoot("apps")
  }
  return coreFileRoot("home")
}
