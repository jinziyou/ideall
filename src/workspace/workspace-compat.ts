import { DIRECTORY_MEDIA_TYPE, type FileRef, type IdeallFile } from "@protocol/file-system"
import type { ResourceRef } from "@protocol/resource"
import { getFileSystem } from "@/filesystem/registry"
import {
  aiTasksPanelFileRef,
  panelFileRef,
  panelForFile,
  resourceFileRef,
  resourceRefForFile,
} from "@/filesystem/resource-file-system"
import { fileTypeInfo } from "@/lib/file-type"
import type { OpenTarget } from "./open-target"
import {
  BUILTIN_APP_SURFACES,
  builtinAppSurfaceForLegacyPanel,
  mountedFileRootId,
} from "./file-roots"
import { FILE_ENGINE_TAB_KIND, fileEngineTab, parseFileEngineTabParams } from "./file-tab"
import { nodeResourceRefForTab, parseResourceTabParams } from "./resource-tab"
import { isStaticTabKind, type StaticTabKind } from "./tab-definitions"
import { tabKey } from "./tab-key"
import type { ModuleId, Tab } from "./types"

const VALID_MODULES = new Set(
  Object.keys({
    home: 1,
    subscriptions: 1,
    apps: 1,
    plugins: 1,
    shell: 1,
    git: 1,
    database: 1,
    audio: 1,
    code: 1,
    trash: 1,
    info: 1,
    community: 1,
    publications: 1,
    browser: 1,
    tool: 1,
    agent: 1,
  } satisfies Record<ModuleId, 1>) as ModuleId[],
)

export function validWorkspaceModule(value: unknown): ModuleId | null {
  return typeof value === "string" && VALID_MODULES.has(value as ModuleId)
    ? (value as ModuleId)
    : null
}

function legacyResourceEngine(ref: ResourceRef): string {
  if (ref.scheme === "node") {
    if (ref.kind === "note") return "ideall.note"
    if (ref.kind === "bookmark") return "ideall.bookmark"
    if (ref.kind === "feed") return "ideall.feed"
    if (ref.kind === "thread") return "ideall.thread"
    if (ref.kind === "folder") return "ideall.directory"
    return "ideall.preview"
  }
  if (ref.scheme === "browser") return "ideall.browser"
  return "ideall.connected"
}

export function legacyResourceRootId(ref: ResourceRef): string {
  if (ref.scheme === "node") {
    if (ref.kind === "note") return "notes"
    if (ref.kind === "bookmark" || ref.kind === "folder") return "bookmarks"
    if (ref.kind === "file") return "files"
    if (ref.kind === "feed") return "subscriptions"
    return "workspace"
  }
  if (ref.scheme === "browser") return "browser"
  if (ref.scheme === "app") return "apps"
  return ref.scheme
}

export function inferredRootIdForFile(ref: FileRef): string | undefined {
  const resource = resourceRefForFile(ref)
  if (resource) return legacyResourceRootId(resource)

  const panel = panelForFile(ref)
  if (panel) {
    if (panel.id === "home") return "home"
    if (panel.id === "subscriptions") return "subscriptions"
    if (panel.id === "bookmarks") return "bookmarks"
    if (panel.id === "files") return "files"
    if (panel.id === "notes") return "notes"
    if (panel.module === "agent") return "workspace"
    if (panel.id === "apps") return "apps"
    if (panel.id === "publications") return "community"
    return "system"
  }

  const provider = getFileSystem(ref.fileSystemId)
  return provider ? mountedFileRootId(provider.descriptor.root) : undefined
}

function compatibilityFileMediaType(name: string): string {
  const info = fileTypeInfo(name, "")
  if (info.preview === "audio") return "audio/*"
  if (info.preview === "video") return "video/*"
  if (info.preview === "image" || info.preview === "svg") return `image/${info.ext || "*"}`
  if (info.preview === "json") return "application/json"
  if (info.preview === "markdown") return "text/markdown"
  if (["code", "csv", "text"].includes(info.preview)) return "text/plain"
  if (info.preview === "pdf") return "application/pdf"
  return "application/octet-stream"
}

function compatibilityResourceMediaType(ref: ResourceRef, name: string): string {
  if (ref.scheme === "node") {
    if (ref.kind === "folder") return DIRECTORY_MEDIA_TYPE
    if (ref.kind === "file") return compatibilityFileMediaType(name)
    return `application/vnd.ideall.${ref.kind}+json`
  }
  if (ref.scheme === "browser") return "text/uri-list"
  if (ref.scheme === "app") return "application/vnd.ideall.app+json"
  return `application/vnd.ideall.${ref.scheme}.${ref.kind}+json`
}

/** ResourceRef 兼容入口的同步 metadata 投影；真实 provider metadata 随后异步刷新。 */
export function compatibilityFileForResource(
  target: Extract<OpenTarget, { type: "resource" }>,
): IdeallFile {
  const { ref, meta } = target
  const directory = ref.scheme === "node" && (ref.kind === "folder" || ref.kind === "note")
  const name = meta?.title || target.title || ref.id
  return {
    ref: resourceFileRef(ref),
    kind: directory ? "directory" : "file",
    name,
    mediaType: compatibilityResourceMediaType(ref, name),
    capabilities: [
      ...(directory ? (["read-directory"] as const) : []),
      ...(meta?.capabilities.map((capability) => `resource:${capability}`) ?? []),
    ],
    source:
      ref.scheme === "node"
        ? { kind: "local", id: "ideall.nodes", label: "本机" }
        : ref.scheme === "info" || ref.scheme === "community"
          ? { kind: "remote", id: ref.scheme, label: ref.scheme }
          : ref.scheme === "app" || ref.scheme === "browser"
            ? { kind: "app", id: ref.scheme, label: ref.scheme }
            : { kind: "system", id: ref.scheme, label: ref.scheme },
    updatedAt: meta?.updatedAt,
    properties: {
      resourceScheme: ref.scheme,
      resourceKind: ref.kind,
      route: meta?.route ?? null,
      iconHint: meta?.iconHint ?? null,
    },
  }
}

function hydrateResourceFileTab(ref: ResourceRef, tab: Tab): Tab {
  const descriptor = fileEngineTab(
    { ref: resourceFileRef(ref), name: tab.title || ref.id },
    legacyResourceEngine(ref),
    { module: tab.module, rootId: legacyResourceRootId(ref) },
  )
  return { ...descriptor, id: tabKey(descriptor) }
}

function hydratePanelFileTab(
  ref: FileRef,
  tab: Tab,
  rootId: string,
  engineId = "ideall.panel",
): Tab {
  const descriptor = fileEngineTab({ ref, name: tab.title || ref.fileId }, engineId, { rootId })
  return { ...descriptor, id: tabKey(descriptor) }
}

function migrateStaticWorkspaceTab(tab: Tab & { kind: StaticTabKind }): Tab | null {
  switch (tab.kind) {
    case "home-overview":
      return hydratePanelFileTab(panelFileRef("home"), tab, "home")
    case "home-notes":
      return hydratePanelFileTab(panelFileRef("notes"), tab, "notes")
    case "subscriptions":
      return hydratePanelFileTab(panelFileRef("subscriptions"), tab, "subscriptions")
    case "home-publications":
      return hydratePanelFileTab(panelFileRef("publications"), tab, "community")
    case "home-resources":
      return hydratePanelFileTab(panelFileRef("files"), tab, "files")
    case "home-bookmarks":
      return hydratePanelFileTab(panelFileRef("bookmarks"), tab, "bookmarks")
    case "home-settings":
      return hydratePanelFileTab(panelFileRef("settings"), tab, "system")
    case "info":
      return hydrateResourceFileTab({ scheme: "info", kind: "home", id: "default" }, tab)
    case "community":
      return hydrateResourceFileTab({ scheme: "community", kind: "home", id: "default" }, tab)
    case "tool-search":
      return hydrateResourceFileTab({ scheme: "tool", kind: "search", id: "default" }, tab)
    case "tool-ai":
      return hydrateResourceFileTab({ scheme: "tool", kind: "ai", id: "default" }, tab)
    case "tool-navigation":
      return hydrateResourceFileTab({ scheme: "tool", kind: "navigation", id: "default" }, tab)
    case "apps":
      return hydratePanelFileTab(panelFileRef("apps"), tab, "apps")
    case "shell":
      return hydratePanelFileTab(panelFileRef("shell"), tab, "system", "ideall.shell")
    case "git":
    case "database":
    case "audio": {
      const surface = BUILTIN_APP_SURFACES[tab.kind]
      return hydratePanelFileTab(surface.ref, tab, mountedFileRootId(surface.ref), surface.engineId)
    }
    case "code":
      return hydratePanelFileTab(panelFileRef("code"), tab, "system")
    case "trash":
      return hydratePanelFileTab(panelFileRef("trash"), tab, "system")
    case "browser-view":
      return hydrateResourceFileTab({ scheme: "browser", kind: "page", id: "default" }, tab)
    case "ai-settings":
    case "ai-mcp":
    case "ai-skills":
    case "ai-rules":
      return hydratePanelFileTab(panelFileRef(tab.kind), tab, "workspace", "ideall.panel-fill")
    case "ai-tasks": {
      const workspaceId = tab.params?.workspaceId
      return workspaceId
        ? hydratePanelFileTab(
            aiTasksPanelFileRef(workspaceId),
            tab,
            "workspace",
            "ideall.panel-fill",
          )
        : null
    }
  }
}

export function migrateWorkspaceTab(tab: Tab): Tab | null {
  if (!validWorkspaceModule(tab.module)) return null
  if (tab.kind === "node") {
    const ref = nodeResourceRefForTab(tab)
    return ref ? hydrateResourceFileTab(ref, tab) : null
  }
  if (tab.kind === "browser-view") {
    return hydrateResourceFileTab({ scheme: "browser", kind: "page", id: "default" }, tab)
  }
  if (tab.kind === "resource") {
    const ref = parseResourceTabParams(tab.params)
    return ref ? hydrateResourceFileTab(ref, tab) : null
  }
  if (tab.kind === FILE_ENGINE_TAB_KIND) {
    const target = parseFileEngineTabParams(tab.params)
    if (!target) return null
    const surface = builtinAppSurfaceForLegacyPanel(target.ref)
    if (surface) {
      return hydratePanelFileTab(
        surface.ref,
        { ...tab, module: surface.module },
        mountedFileRootId(surface.ref),
        surface.engineId,
      )
    }
  }
  if (isStaticTabKind(tab.kind)) {
    return migrateStaticWorkspaceTab(tab as Tab & { kind: StaticTabKind })
  }
  return { ...tab, id: tabKey(tab) }
}

export function migrateWorkspaceTabs(tabs: readonly Tab[]): {
  tabs: Tab[]
  idMap: ReadonlyMap<string, string>
} {
  const migrated: Tab[] = []
  const seen = new Set<string>()
  const idMap = new Map<string, string>()
  for (const tab of tabs) {
    const next = migrateWorkspaceTab(tab)
    if (!next) continue
    idMap.set(tab.id, next.id)
    if (seen.has(next.id)) continue
    seen.add(next.id)
    migrated.push(next)
  }
  return { tabs: migrated, idMap }
}
