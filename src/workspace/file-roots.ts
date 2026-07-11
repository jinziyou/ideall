import type { ComponentType } from "react"
import {
  AppWindow,
  Bookmark,
  Boxes,
  Compass,
  FileText,
  FolderOpen,
  Globe,
  Home,
  Rss,
  Settings,
  Users,
} from "lucide-react"
import {
  fileRefKey,
  parseFileRefKey,
  type DirectoryEntry,
  type FileRef,
} from "@protocol/file-system"
import type { ResourceRef } from "@protocol/resource"
import type { ModuleId, WsMode } from "./types"
import { corePlaceRef, panelFileRef, resourceFileRef } from "@/filesystem/resource-file-system"
import {
  AUDIO_LIBRARY_ROOT_REF,
  DATABASE_ROOT_REF,
  GIT_ROOT_REF,
} from "@/filesystem/builtin-app-roots"

/**
 * 合成文件系统根目录的直接子树。根本身不进入活动栏；这些目录就是桌面端的
 * 一级空间锚点。合成根始终包含全部来源，Display 再按 modes 提供本地/连接镜头。
 */
export type CoreFileRootId =
  | "home"
  | "subscriptions"
  | "bookmarks"
  | "files"
  | "notes"
  | "workspace"
  | "apps"
  | "info"
  | "community"
  | "tool"
  | "browser"
  | "system"

export type CoreFileRoot = {
  id: CoreFileRootId
  label: string
  sidebarTitle: string
  icon: ComponentType<{ className?: string }>
  module: ModuleId
  modes: readonly WsMode[]
  navigationHidden?: boolean
  colorClass?: string
  defaultFile?: FileRef
}

const LOCAL_MODE: readonly WsMode[] = ["local"]
const CONNECTED_MODE: readonly WsMode[] = ["connected"]
const ALL_MODES: readonly WsMode[] = ["local", "connected"]

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

export const CORE_FILE_ROOTS: readonly CoreFileRoot[] = [
  {
    id: "home",
    label: "我的",
    sidebarTitle: "我的",
    icon: Home,
    module: "home",
    modes: LOCAL_MODE,
    defaultFile: panelFileRef("home"),
  },
  {
    id: "subscriptions",
    label: "关注",
    sidebarTitle: "关注",
    icon: Rss,
    module: "subscriptions",
    modes: LOCAL_MODE,
    colorClass: "text-spoke-info",
    defaultFile: panelFileRef("subscriptions"),
  },
  {
    id: "bookmarks",
    label: "书签",
    sidebarTitle: "书签",
    icon: Bookmark,
    module: "home",
    modes: LOCAL_MODE,
    navigationHidden: true,
    defaultFile: panelFileRef("bookmarks"),
  },
  {
    id: "files",
    label: "文件",
    sidebarTitle: "文件",
    icon: FolderOpen,
    module: "home",
    modes: LOCAL_MODE,
    navigationHidden: true,
    defaultFile: panelFileRef("files"),
  },
  {
    id: "notes",
    label: "笔记",
    sidebarTitle: "笔记",
    icon: FileText,
    module: "home",
    modes: LOCAL_MODE,
    navigationHidden: true,
    defaultFile: panelFileRef("notes"),
  },
  {
    id: "workspace",
    label: "工作区",
    sidebarTitle: "工作区",
    icon: Boxes,
    module: "agent",
    modes: ALL_MODES,
    navigationHidden: true,
  },
  {
    id: "apps",
    label: "应用",
    sidebarTitle: "应用",
    icon: AppWindow,
    module: "apps",
    modes: LOCAL_MODE,
    colorClass: "text-spoke-tool",
    defaultFile: panelFileRef("apps"),
  },
  {
    id: "info",
    label: "资讯",
    sidebarTitle: "资讯",
    icon: Globe,
    module: "info",
    modes: CONNECTED_MODE,
    colorClass: "text-spoke-info",
    defaultFile: resource({ scheme: "info", kind: "home", id: "default" }),
  },
  {
    id: "community",
    label: "社区",
    sidebarTitle: "社区",
    icon: Users,
    module: "community",
    modes: CONNECTED_MODE,
    colorClass: "text-spoke-community",
    defaultFile: resource({ scheme: "community", kind: "home", id: "default" }),
  },
  {
    id: "browser",
    label: "浏览器",
    sidebarTitle: "浏览器",
    icon: Globe,
    module: "browser",
    modes: CONNECTED_MODE,
    colorClass: "text-spoke-community",
    defaultFile: resource({ scheme: "browser", kind: "page", id: "default" }),
  },
  {
    id: "tool",
    label: "工具",
    sidebarTitle: "工具",
    icon: Compass,
    module: "tool",
    modes: ALL_MODES,
    colorClass: "text-spoke-tool",
    defaultFile: resource({ scheme: "tool", kind: "search", id: "default" }),
  },
  {
    id: "system",
    label: "系统",
    sidebarTitle: "系统",
    icon: Settings,
    module: "home",
    modes: LOCAL_MODE,
    navigationHidden: true,
    defaultFile: panelFileRef("settings"),
  },
] as const

export const MOUNTED_FILE_ROOT_PREFIX = "mount:"

export function isCoreFileRootId(value: string): value is CoreFileRootId {
  return CORE_FILE_ROOTS.some((root) => root.id === value)
}

function configuredEntryModes(entry: DirectoryEntry): readonly WsMode[] | null {
  const value = entry.properties?.workspaceModes
  if (!Array.isArray(value)) return null
  const modes = value.filter(
    (candidate): candidate is WsMode => candidate === "local" || candidate === "connected",
  )
  return modes.length > 0 ? modes : null
}

/** Display 镜头过滤；文件系统合成根本身始终保留完整目录。动态挂载默认属于本地模式。 */
export function rootEntryVisibleInMode(entry: DirectoryEntry, mode: WsMode): boolean {
  if (entry.properties?.navigationHidden === true) return false
  if (isCoreFileRootId(entry.entryId)) {
    const root = coreFileRoot(entry.entryId)
    return !root.navigationHidden && root.modes.includes(mode)
  }
  return (configuredEntryModes(entry) ?? LOCAL_MODE).includes(mode)
}

export function rootEntriesForMode(
  entries: readonly DirectoryEntry[],
  mode: WsMode,
): DirectoryEntry[] {
  return entries.filter((entry) => rootEntryVisibleInMode(entry, mode))
}

export function coreFileRootMode(root: CoreFileRoot, current: WsMode): WsMode {
  return root.modes.includes(current) ? current : root.modes[0]
}

export function coerceCoreFileRootIdForMode(
  rootId: string,
  mode: WsMode,
  fallback?: string,
): string {
  if (!isCoreFileRootId(rootId)) return rootId
  const root = coreFileRoot(rootId)
  if (!root.navigationHidden && root.modes.includes(mode)) return rootId
  if (fallback && (!isCoreFileRootId(fallback) || coreFileRoot(fallback).modes.includes(mode))) {
    if (!isCoreFileRootId(fallback) || !coreFileRoot(fallback).navigationHidden) return fallback
  }
  return mode === "local" ? "home" : "info"
}

export function mountedFileRootId(ref: FileRef): string {
  return `${MOUNTED_FILE_ROOT_PREFIX}${fileRefKey(ref)}`
}

export function fileRootRef(rootId: string): FileRef | null {
  if (isCoreFileRootId(rootId)) return corePlaceRef(rootId)
  return rootId.startsWith(MOUNTED_FILE_ROOT_PREFIX)
    ? parseFileRefKey(rootId.slice(MOUNTED_FILE_ROOT_PREFIX.length))
    : null
}

export function defaultFileForPath(pathname: string): { ref: FileRef; rootId: string } | null {
  if (pathname.startsWith("/home/settings")) {
    return { ref: panelFileRef("settings"), rootId: "home" }
  }
  if (pathname.startsWith("/home/subscriptions")) {
    return { ref: panelFileRef("subscriptions"), rootId: "subscriptions" }
  }
  if (pathname.startsWith("/home/publications")) {
    return { ref: panelFileRef("publications"), rootId: "community" }
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
    return { ref: resource({ scheme: "info", kind: "home", id: "default" }), rootId: "info" }
  }
  if (pathname.startsWith("/community")) {
    return {
      ref: resource({ scheme: "community", kind: "home", id: "default" }),
      rootId: "community",
    }
  }
  if (pathname.startsWith("/browser")) {
    return {
      ref: resource({ scheme: "browser", kind: "page", id: "default" }),
      rootId: "browser",
    }
  }
  if (pathname.startsWith("/tool/ai")) {
    return { ref: resource({ scheme: "tool", kind: "ai", id: "default" }), rootId: "tool" }
  }
  if (pathname.startsWith("/tool/navigation")) {
    return {
      ref: resource({ scheme: "tool", kind: "navigation", id: "default" }),
      rootId: "tool",
    }
  }
  if (pathname.startsWith("/tool")) {
    return { ref: resource({ scheme: "tool", kind: "search", id: "default" }), rootId: "tool" }
  }
  for (const id of ["audio", "database", "git"] as const) {
    if (pathname.startsWith(`/${id}`)) {
      const surface = BUILTIN_APP_SURFACES[id]
      return { ref: surface.ref, rootId: mountedFileRootId(surface.ref) }
    }
  }
  const systemPanel = (["shell", "code", "trash"] as const).find((id) =>
    pathname.startsWith(`/${id}`),
  )
  return systemPanel ? { ref: panelFileRef(systemPanel), rootId: "system" } : null
}

export function coreFileRoot(id: string | null | undefined): CoreFileRoot {
  return CORE_FILE_ROOTS.find((root) => root.id === id) ?? CORE_FILE_ROOTS[0]
}

export function coreFileRootForModule(module: ModuleId): CoreFileRoot {
  if (module === "subscriptions") return coreFileRoot("subscriptions")
  if (module === "apps") return coreFileRoot("apps")
  if (module === "info") return coreFileRoot("info")
  if (module === "community" || module === "publications") return coreFileRoot("community")
  if (module === "tool") return coreFileRoot("tool")
  if (module === "browser") return coreFileRoot("browser")
  if (module === "agent") return coreFileRoot("workspace")
  if (["shell", "git", "database", "audio", "code", "trash", "plugins"].includes(module)) {
    return coreFileRoot("system")
  }
  return coreFileRoot("home")
}
