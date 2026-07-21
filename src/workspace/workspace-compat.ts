import type { FileRef } from "@protocol/file-system"
import type { ResourceRef } from "@protocol/resource"
import { getFileSystem } from "@/filesystem/registry"
import { normalizeIdeallPath } from "@/filesystem/path"
import {
  aiTasksPanelFileRef,
  panelFileRef,
  panelForFile,
  placeForFile,
  resourceRefForFile,
} from "@/filesystem/resource-file-system"
import {
  BUILTIN_APP_SURFACES,
  builtinAppSurfaceForLegacyPanel,
  builtinAppSurfaceForRoot,
  coreFileRootForRef,
  isCoreFileRootId,
  normalizeNavigationRootId,
} from "./file-roots"
import { FILE_ENGINE_TAB_KIND, fileEngineTab, parseFileEngineTabParams } from "./file-tab"
import { nodeResourceRefForTab, parseResourceTabParams } from "./resource-tab"
import { resourceFileTab, rootForResource } from "./resource-file-tab"
import { isStaticTabKind, type StaticTabKind } from "./tab-definitions"
import { tabKey } from "./tab-key"
import type { ModuleId, Tab } from "./types"
import {
  directorySurface,
  directorySurfaceForLegacyPanel,
  directorySurfaceForRef,
  type DirectorySurface,
} from "./directory-surfaces"
import {
  capabilitySurfaceForLegacyPanel,
  capabilitySurfaceForRef,
  capabilitySurfaceForStaticKind,
  type CapabilitySurface,
} from "./capability-surfaces"

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

function validNavigationPath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  try {
    return normalizeIdeallPath(value)
  } catch {
    return undefined
  }
}

export function inferredRootIdForFile(ref: FileRef): string | undefined {
  const navigationRoot = coreFileRootForRef(ref)
  if (navigationRoot) return navigationRoot.id
  const capabilitySurface = capabilitySurfaceForRef(ref)
  if (capabilitySurface) return capabilitySurface.rootId
  const directorySurface = directorySurfaceForRef(ref)
  if (directorySurface) return directorySurface.rootId
  if (builtinAppSurfaceForRoot(ref)) return "apps"
  const resource = resourceRefForFile(ref)
  if (resource) return rootForResource(resource)
  const place = placeForFile(ref)
  if (place) {
    if (["home", "subscriptions", "bookmarks", "files", "notes"].includes(place)) return "home"
    if (place === "workspace") return "activity"
    if (["info", "community", "browser"].includes(place)) return "browse"
    if (place === "system") return "settings"
    return "apps"
  }

  const panel = panelForFile(ref)
  if (panel) {
    if (["home", "subscriptions", "bookmarks", "files", "notes"].includes(panel.id)) {
      return "home"
    }
    if (panel.id === "spaces" || panel.id === "tasks" || panel.id === "trash") {
      return "activity"
    }
    if (panel.id === "ai-tasks" || panel.id.startsWith("ai-tasks:")) return "activity"
    if (panel.module === "agent") return "settings"
    if (panel.id === "apps") return "apps"
    if (panel.id === "publications") return "browse"
    if (panel.id === "settings") return "settings"
    return "apps"
  }

  const provider = getFileSystem(ref.fileSystemId)
  return provider ? "apps" : undefined
}

function hydrateResourceFileTab(ref: ResourceRef, tab: Tab): Tab {
  const descriptor = { ...resourceFileTab(ref, tab.title || ref.id), module: tab.module }
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

type SemanticSurface = DirectorySurface | CapabilitySurface

function hydrateSemanticSurfaceTab(
  surface: SemanticSurface,
  tab: Tab,
  engineId = surface.engineId,
): Tab {
  const descriptor = fileEngineTab(
    { ref: surface.ref, name: tab.title || surface.ref.fileId },
    engineId,
    {
      module: surface.module,
      rootId: surface.rootId,
      ...(engineId === surface.engineId ? { path: surface.navigationPath } : {}),
      navigationPath: surface.navigationPath,
    },
  )
  return { ...descriptor, id: tabKey(descriptor) }
}

function migrateStaticWorkspaceTab(tab: Tab & { kind: StaticTabKind }): Tab | null {
  switch (tab.kind) {
    case "home-overview":
      return hydratePanelFileTab(panelFileRef("home"), tab, "home")
    case "home-inbox":
      return hydratePanelFileTab(panelFileRef("inbox"), tab, "home")
    case "home-notes":
      return hydratePanelFileTab(panelFileRef("notes"), tab, "home")
    case "subscriptions":
      return hydrateSemanticSurfaceTab(directorySurface("subscriptions"), tab)
    case "home-publications":
      return hydratePanelFileTab(panelFileRef("publications"), tab, "browse")
    case "home-resources":
      return hydrateSemanticSurfaceTab(directorySurface("resources"), tab)
    case "home-bookmarks":
      return hydrateSemanticSurfaceTab(directorySurface("bookmarks"), tab)
    case "home-settings":
    case "ai-settings":
    case "agent-spaces":
    case "agent-task-list": {
      const surface = capabilitySurfaceForStaticKind(tab.kind)
      return surface ? hydrateSemanticSurfaceTab(surface, tab) : null
    }
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
      return hydrateSemanticSurfaceTab(directorySurface("installed-apps"), tab)
    case "shell":
      return hydratePanelFileTab(panelFileRef("shell"), tab, "apps", "ideall.shell")
    case "git":
    case "database":
    case "audio": {
      const surface = BUILTIN_APP_SURFACES[tab.kind]
      return hydratePanelFileTab(surface.ref, tab, "apps", surface.engineId)
    }
    case "code":
      return hydratePanelFileTab(panelFileRef("code"), tab, "apps")
    case "trash":
      return hydrateSemanticSurfaceTab(directorySurface("trash"), tab)
    case "browser-view":
      return hydrateResourceFileTab({ scheme: "browser", kind: "page", id: "default" }, tab)
    case "ai-mcp":
    case "ai-skills":
    case "ai-rules":
      return hydratePanelFileTab(panelFileRef(tab.kind), tab, "settings", "ideall.panel-fill")
    case "ai-tasks": {
      const workspaceId = tab.params?.workspaceId
      return workspaceId
        ? hydratePanelFileTab(
            aiTasksPanelFileRef(workspaceId),
            tab,
            "activity",
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
    const legacyDirectorySurface = directorySurfaceForLegacyPanel(target.ref)
    if (legacyDirectorySurface) return hydrateSemanticSurfaceTab(legacyDirectorySurface, tab)
    const legacyCapabilitySurface = capabilitySurfaceForLegacyPanel(target.ref)
    if (legacyCapabilitySurface) {
      return hydrateSemanticSurfaceTab(legacyCapabilitySurface, tab)
    }
    const surface = builtinAppSurfaceForLegacyPanel(target.ref)
    if (surface) {
      return hydratePanelFileTab(
        surface.ref,
        { ...tab, module: surface.module },
        "apps",
        surface.engineId,
      )
    }
    const directorySurface = directorySurfaceForRef(target.ref)
    if (directorySurface) {
      if (target.engineId === "ideall.panel" || target.engineId === "ideall.panel-fill") {
        return hydrateSemanticSurfaceTab(directorySurface, tab)
      }
      return hydrateSemanticSurfaceTab(directorySurface, tab, target.engineId)
    }
    const capabilitySurface = capabilitySurfaceForRef(target.ref)
    if (capabilitySurface) {
      if (target.engineId === "ideall.panel" || target.engineId === "ideall.panel-fill") {
        return hydrateSemanticSurfaceTab(capabilitySurface, tab)
      }
      return hydrateSemanticSurfaceTab(capabilitySurface, tab, target.engineId)
    }
    const inferredRootId = inferredRootIdForFile(target.ref)
    return {
      ...tab,
      id: tabKey(tab),
      navigationPath: validNavigationPath(tab.navigationPath),
      rootId:
        tab.rootId && isCoreFileRootId(tab.rootId)
          ? tab.rootId
          : normalizeNavigationRootId(inferredRootId ?? tab.rootId),
    }
  }
  if (isStaticTabKind(tab.kind)) {
    return migrateStaticWorkspaceTab(tab as Tab & { kind: StaticTabKind })
  }
  return { ...tab, id: tabKey(tab), navigationPath: validNavigationPath(tab.navigationPath) }
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
