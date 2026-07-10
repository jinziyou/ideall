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
import { fileRefKey, parseFileRefKey, type FileRef } from "@protocol/file-system"
import type { ResourceRef } from "@protocol/resource"
import type { ModuleId } from "./types"
import { corePlaceRef, panelFileRef, resourceFileRef } from "@/filesystem/resource-file-system"

/**
 * 合成文件系统根目录的直接子树。根本身不进入活动栏；这些目录就是桌面端的
 * 一级空间锚点。ModuleId 只在旧标签迁移期保留，不再决定哪些根可见。
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
  colorClass?: string
  defaultFile?: FileRef
}

const resource = (ref: ResourceRef) => resourceFileRef(ref)

export const CORE_FILE_ROOTS: readonly CoreFileRoot[] = [
  {
    id: "home",
    label: "Home",
    sidebarTitle: "Home",
    icon: Home,
    module: "home",
    defaultFile: panelFileRef("home"),
  },
  {
    id: "subscriptions",
    label: "关注",
    sidebarTitle: "关注",
    icon: Rss,
    module: "subscriptions",
    colorClass: "text-spoke-info",
    defaultFile: panelFileRef("subscriptions"),
  },
  {
    id: "bookmarks",
    label: "书签",
    sidebarTitle: "书签",
    icon: Bookmark,
    module: "home",
    defaultFile: panelFileRef("bookmarks"),
  },
  {
    id: "files",
    label: "文件",
    sidebarTitle: "文件",
    icon: FolderOpen,
    module: "home",
    defaultFile: panelFileRef("files"),
  },
  {
    id: "notes",
    label: "笔记",
    sidebarTitle: "笔记",
    icon: FileText,
    module: "home",
    defaultFile: panelFileRef("notes"),
  },
  {
    id: "workspace",
    label: "工作区",
    sidebarTitle: "工作区",
    icon: Boxes,
    module: "agent",
  },
  {
    id: "apps",
    label: "应用",
    sidebarTitle: "应用",
    icon: AppWindow,
    module: "apps",
    colorClass: "text-spoke-tool",
    defaultFile: panelFileRef("apps"),
  },
  {
    id: "info",
    label: "资讯",
    sidebarTitle: "资讯",
    icon: Globe,
    module: "info",
    colorClass: "text-spoke-info",
    defaultFile: resource({ scheme: "info", kind: "home", id: "default" }),
  },
  {
    id: "community",
    label: "社区",
    sidebarTitle: "社区",
    icon: Users,
    module: "community",
    colorClass: "text-spoke-community",
    defaultFile: resource({ scheme: "community", kind: "home", id: "default" }),
  },
  {
    id: "tool",
    label: "工具",
    sidebarTitle: "工具",
    icon: Compass,
    module: "tool",
    colorClass: "text-spoke-tool",
    defaultFile: resource({ scheme: "tool", kind: "search", id: "default" }),
  },
  {
    id: "browser",
    label: "浏览器",
    sidebarTitle: "浏览器",
    icon: Globe,
    module: "browser",
    colorClass: "text-spoke-community",
    defaultFile: resource({ scheme: "browser", kind: "page", id: "default" }),
  },
  {
    id: "system",
    label: "系统",
    sidebarTitle: "系统",
    icon: Settings,
    module: "home",
    defaultFile: panelFileRef("settings"),
  },
] as const

export const MOUNTED_FILE_ROOT_PREFIX = "mount:"

export function isCoreFileRootId(value: string): value is CoreFileRootId {
  return CORE_FILE_ROOTS.some((root) => root.id === value)
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

export function defaultFileForPath(
  pathname: string,
): { ref: FileRef; rootId: CoreFileRootId } | null {
  if (pathname.startsWith("/home/settings")) {
    return { ref: panelFileRef("settings"), rootId: "system" }
  }
  if (pathname.startsWith("/home/subscriptions")) {
    return { ref: panelFileRef("subscriptions"), rootId: "subscriptions" }
  }
  if (pathname.startsWith("/home/publications")) {
    return { ref: panelFileRef("publications"), rootId: "community" }
  }
  if (pathname.startsWith("/home/bookmarks")) {
    return { ref: panelFileRef("bookmarks"), rootId: "bookmarks" }
  }
  if (pathname.startsWith("/home/resources")) {
    return { ref: panelFileRef("files"), rootId: "files" }
  }
  if (pathname.startsWith("/home/notes")) {
    return { ref: panelFileRef("notes"), rootId: "notes" }
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
  const systemPanel = (["shell", "git", "database", "audio", "code", "trash"] as const).find((id) =>
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
