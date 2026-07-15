import {
  DIRECTORY_MEDIA_TYPE,
  fileRefKey,
  sameFileRef,
  type DirectoryEntry,
  type FileRef,
  type IdeallFile,
} from "@protocol/file-system"
import type { ResourceRef } from "@protocol/resource"
import { paginateDirectoryItems } from "./provider-input"
import { corePlaceRef, resourceFileRef } from "./resource-file-system"
import {
  AGENT_SETTINGS_FILE_REF,
  AGENT_TASKS_FILE_REF,
  AGENT_WORKSPACES_FILE_REF,
  INSTALLED_APPS_ROOT_REF,
  SETTINGS_ROOT_REF,
} from "./builtin-app-roots"
import { trashRootRef } from "./trash-file-system"
import {
  FileSystemError,
  type FileReadOptions,
  type FileSystemAccessContext,
  type FileSystemProvider,
  type ReadDirectoryOptions,
} from "./types"

export const NAVIGATION_FILE_SYSTEM_ID = "ideall.navigation"

export const NAVIGATION_SECTION_IDS = ["home", "activity", "browse", "apps", "settings"] as const

export type NavigationSectionId = (typeof NAVIGATION_SECTION_IDS)[number]

export type NavigationTargetKind = "file" | "directory"

export type NavigationItemDefinition = Readonly<{
  id: string
  pathName: string
  name: string
  iconHint: string
  target: FileRef
  preferredEngine: string
  targetKind: NavigationTargetKind
}>

export type NavigationSectionDefinition = Readonly<{
  id: NavigationSectionId
  pathName: NavigationSectionId
  name: string
  iconHint: string
  items: readonly NavigationItemDefinition[]
}>

const resource = (
  ref: ResourceRef,
  iconHint: string,
  preferredEngine = "ideall.connected",
): Omit<NavigationItemDefinition, "id" | "pathName" | "name"> => ({
  iconHint,
  target: resourceFileRef(ref),
  preferredEngine,
  targetKind: "file",
})

/**
 * 产品导航的纯数据投影。目标与 Display 选择保持为稳定 FileRef/Engine id，filesystem 层
 * 不依赖 React 图标或 workspace 组件。
 */
export const NAVIGATION_SECTIONS: readonly NavigationSectionDefinition[] = [
  {
    id: "home",
    pathName: "home",
    name: "我的",
    iconHint: "home",
    items: [
      {
        id: "following",
        pathName: "following",
        name: "关注",
        iconHint: "rss",
        target: corePlaceRef("subscriptions"),
        preferredEngine: "ideall.subscriptions",
        targetKind: "directory",
      },
      {
        id: "bookmarks",
        pathName: "bookmarks",
        name: "书签",
        iconHint: "bookmark",
        target: corePlaceRef("bookmarks"),
        preferredEngine: "ideall.bookmarks",
        targetKind: "directory",
      },
      {
        id: "resources",
        pathName: "resources",
        name: "资源",
        iconHint: "folder-open",
        target: corePlaceRef("files"),
        preferredEngine: "ideall.resources",
        targetKind: "directory",
      },
      {
        id: "files",
        pathName: "files",
        name: "文件",
        iconHint: "file-text",
        target: corePlaceRef("notes"),
        preferredEngine: "ideall.directory",
        targetKind: "directory",
      },
    ],
  },
  {
    id: "activity",
    pathName: "activity",
    name: "活动",
    iconHint: "history",
    items: [
      {
        id: "spaces",
        pathName: "spaces",
        name: "空间",
        iconHint: "boxes",
        target: AGENT_WORKSPACES_FILE_REF,
        preferredEngine: "ideall.agent-spaces",
        targetKind: "file",
      },
      {
        id: "tasks",
        pathName: "tasks",
        name: "任务",
        iconHint: "sparkles",
        target: AGENT_TASKS_FILE_REF,
        preferredEngine: "ideall.agent-tasks",
        targetKind: "file",
      },
      {
        id: "deleted",
        pathName: "deleted",
        name: "删除",
        iconHint: "trash-2",
        target: trashRootRef,
        preferredEngine: "ideall.trash",
        targetKind: "directory",
      },
    ],
  },
  {
    id: "browse",
    pathName: "browse",
    name: "浏览",
    iconHint: "compass",
    items: [
      {
        id: "news",
        pathName: "news",
        name: "新闻",
        ...resource({ scheme: "info", kind: "home", id: "default" }, "newspaper"),
      },
      {
        id: "community",
        pathName: "community",
        name: "社区",
        ...resource({ scheme: "community", kind: "home", id: "default" }, "users"),
      },
      {
        id: "browser",
        pathName: "browser",
        name: "浏览器",
        ...resource(
          { scheme: "browser", kind: "page", id: "default" },
          "compass",
          "ideall.browser",
        ),
      },
    ],
  },
  {
    id: "apps",
    pathName: "apps",
    name: "应用",
    iconHint: "app-window",
    items: [
      {
        id: "search",
        pathName: "search",
        name: "搜索",
        ...resource({ scheme: "tool", kind: "search", id: "default" }, "search"),
      },
      {
        id: "local-apps",
        pathName: "local-apps",
        name: "本地应用",
        iconHint: "app-window",
        target: INSTALLED_APPS_ROOT_REF,
        preferredEngine: "ideall.installed-apps",
        targetKind: "directory",
      },
    ],
  },
  {
    id: "settings",
    pathName: "settings",
    name: "设置",
    iconHint: "settings",
    items: [
      {
        id: "basic",
        pathName: "basic",
        name: "基本",
        iconHint: "sliders-horizontal",
        target: SETTINGS_ROOT_REF,
        preferredEngine: "ideall.settings",
        targetKind: "directory",
      },
      {
        id: "ai",
        pathName: "ai",
        name: "AI",
        iconHint: "bot",
        target: AGENT_SETTINGS_FILE_REF,
        preferredEngine: "ideall.agent-settings",
        targetKind: "file",
      },
    ],
  },
] as const

export const navigationRootRef: FileRef = {
  fileSystemId: NAVIGATION_FILE_SYSTEM_ID,
  fileId: "/",
}

export function navigationDirectoryRef(section: NavigationSectionId): FileRef {
  return { fileSystemId: NAVIGATION_FILE_SYSTEM_ID, fileId: `/${section}` }
}

function sectionForRef(ref: FileRef): NavigationSectionDefinition | null {
  if (ref.fileSystemId !== NAVIGATION_FILE_SYSTEM_ID) return null
  return (
    NAVIGATION_SECTIONS.find((section) => sameFileRef(ref, navigationDirectoryRef(section.id))) ??
    null
  )
}

const NAVIGATION_SOURCE = {
  kind: "system",
  id: NAVIGATION_FILE_SYSTEM_ID,
  label: "ideall 导航",
  readOnly: true,
} as const

function navigationRootFile(): IdeallFile {
  return {
    ref: navigationRootRef,
    kind: "directory",
    name: "导航",
    mediaType: DIRECTORY_MEDIA_TYPE,
    capabilities: ["read-directory"],
    source: NAVIGATION_SOURCE,
    properties: { canonicalPath: "/", hidden: true, navigationRoot: true },
  }
}

function navigationDirectoryFile(section: NavigationSectionDefinition): IdeallFile {
  return {
    ref: navigationDirectoryRef(section.id),
    kind: "directory",
    name: section.name,
    mediaType: DIRECTORY_MEDIA_TYPE,
    capabilities: ["read-directory"],
    source: NAVIGATION_SOURCE,
    properties: {
      canonicalPath: `/${section.pathName}`,
      navigationSection: section.id,
      iconHint: section.iconHint,
    },
  }
}

function sectionEntry(section: NavigationSectionDefinition, index: number): DirectoryEntry {
  return {
    entryId: section.id,
    pathName: section.pathName,
    parent: navigationRootRef,
    target: navigationDirectoryRef(section.id),
    name: section.name,
    kind: "link",
    sortKey: String(index).padStart(3, "0"),
    file: navigationDirectoryFile(section),
    properties: {
      navigationSection: section.id,
      iconHint: section.iconHint,
      targetKind: "directory",
    },
  }
}

function itemEntry(
  section: NavigationSectionDefinition,
  item: NavigationItemDefinition,
  index: number,
): DirectoryEntry {
  return {
    entryId: item.id,
    pathName: item.pathName,
    parent: navigationDirectoryRef(section.id),
    target: item.target,
    name: item.name,
    kind: "link",
    sortKey: String(index).padStart(3, "0"),
    properties: {
      navigationSection: section.id,
      navigationItem: item.id,
      preferredEngine: item.preferredEngine,
      targetKind: item.targetKind,
      iconHint: item.iconHint,
    },
  }
}

function entriesForDirectory(ref: FileRef): readonly DirectoryEntry[] | null {
  if (sameFileRef(ref, navigationRootRef)) return NAVIGATION_SECTIONS.map(sectionEntry)
  const section = sectionForRef(ref)
  return section ? section.items.map((item, index) => itemEntry(section, item, index)) : null
}

function requireNavigationFile(ref: FileRef): IdeallFile {
  if (sameFileRef(ref, navigationRootRef)) return navigationRootFile()
  const section = sectionForRef(ref)
  if (section) return navigationDirectoryFile(section)
  throw new FileSystemError("not-found", `Navigation file not found: ${fileRefKey(ref)}`, ref)
}

export const navigationFileSystem: FileSystemProvider = {
  descriptor: {
    fileSystemId: NAVIGATION_FILE_SYSTEM_ID,
    name: "ideall 导航",
    root: navigationRootRef,
    source: NAVIGATION_SOURCE,
    capabilities: ["read-directory"],
  },

  async stat(ref: FileRef, _ctx: FileSystemAccessContext): Promise<IdeallFile | null> {
    if (sameFileRef(ref, navigationRootRef)) return navigationRootFile()
    const section = sectionForRef(ref)
    return section ? navigationDirectoryFile(section) : null
  },

  async readDirectory(
    ref: FileRef,
    _ctx: FileSystemAccessContext,
    options: ReadDirectoryOptions = {},
  ) {
    const entries = entriesForDirectory(ref)
    if (!entries) {
      throw new FileSystemError(
        "not-found",
        `Navigation directory not found: ${fileRefKey(ref)}`,
        ref,
      )
    }
    const page = paginateDirectoryItems(ref, entries, options)
    return { entries: page.items, nextCursor: page.nextCursor }
  },

  async read(ref: FileRef, _ctx: FileSystemAccessContext, _options?: FileReadOptions) {
    requireNavigationFile(ref)
    throw new FileSystemError("unsupported", "Navigation directories have no readable content", ref)
  },

  async write(ref) {
    requireNavigationFile(ref)
    throw new FileSystemError("unsupported", "Navigation filesystem is read-only", ref)
  },

  async actions(ref) {
    requireNavigationFile(ref)
    return []
  },

  async invoke(ref, action) {
    requireNavigationFile(ref)
    throw new FileSystemError("unsupported", `Unsupported navigation action: ${action}`, ref)
  },
}
