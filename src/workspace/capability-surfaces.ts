import { sameFileRef, type FileRef } from "@protocol/file-system"
import {
  AGENT_SETTINGS_FILE_REF,
  AGENT_TASKS_FILE_REF,
  AGENT_WORKSPACES_FILE_REF,
  SETTINGS_ROOT_REF,
} from "@/filesystem/builtin-app-roots"
import type { IdeallPath } from "@/filesystem/path"
import type { StaticTabKind } from "./tab-definitions"
import type { ModuleId } from "./types"

export type CapabilitySurfaceId = "agent-spaces" | "agent-tasks" | "settings" | "agent-settings"

export type CapabilitySurface = Readonly<{
  id: CapabilitySurfaceId
  legacyPanelId: string
  legacyStaticKind: StaticTabKind
  ref: FileRef
  engineId: string
  module: ModuleId
  rootId: "activity" | "settings"
  navigationPath: IdeallPath
  /** 旧 URL 仅在深链读取边界解析；新入口一律生成 navigationPath。 */
  legacyPaths: readonly IdeallPath[]
}>

/**
 * 管理能力的真实文件与 Display 位置。与 directory-surfaces 不同，这些目标是普通配置文件
 * 或能力根；旧 panel/static/URL 只在打开和水合边界解引用。
 */
export const CAPABILITY_SURFACES: readonly CapabilitySurface[] = [
  {
    id: "agent-spaces",
    legacyPanelId: "spaces",
    legacyStaticKind: "agent-spaces",
    ref: AGENT_WORKSPACES_FILE_REF,
    engineId: "ideall.agent-spaces",
    module: "agent",
    rootId: "activity",
    navigationPath: "/activity/spaces",
    legacyPaths: [],
  },
  {
    id: "agent-tasks",
    legacyPanelId: "tasks",
    legacyStaticKind: "agent-task-list",
    ref: AGENT_TASKS_FILE_REF,
    engineId: "ideall.agent-tasks",
    module: "agent",
    rootId: "activity",
    navigationPath: "/activity/tasks",
    legacyPaths: [],
  },
  {
    id: "settings",
    legacyPanelId: "settings",
    legacyStaticKind: "home-settings",
    ref: SETTINGS_ROOT_REF,
    engineId: "ideall.settings",
    module: "home",
    rootId: "settings",
    navigationPath: "/settings/basic",
    legacyPaths: ["/home/settings"],
  },
  {
    id: "agent-settings",
    legacyPanelId: "ai-settings",
    legacyStaticKind: "ai-settings",
    ref: AGENT_SETTINGS_FILE_REF,
    engineId: "ideall.agent-settings",
    module: "agent",
    rootId: "settings",
    navigationPath: "/settings/ai",
    legacyPaths: ["/ai"],
  },
] as const

export function capabilitySurface(id: CapabilitySurfaceId): CapabilitySurface {
  const surface = CAPABILITY_SURFACES.find((candidate) => candidate.id === id)
  if (!surface) throw new Error(`Unknown capability surface: ${id}`)
  return surface
}

export function capabilitySurfaceForRef(ref: FileRef): CapabilitySurface | null {
  return CAPABILITY_SURFACES.find((surface) => sameFileRef(surface.ref, ref)) ?? null
}

export function capabilitySurfaceForLegacyPanel(ref: FileRef): CapabilitySurface | null {
  if (ref.fileSystemId !== "ideall.core" || !ref.fileId.startsWith("panel:")) return null
  const panelId = ref.fileId.slice("panel:".length)
  return CAPABILITY_SURFACES.find((surface) => surface.legacyPanelId === panelId) ?? null
}

export function capabilitySurfaceForStaticKind(kind: StaticTabKind): CapabilitySurface | null {
  return CAPABILITY_SURFACES.find((surface) => surface.legacyStaticKind === kind) ?? null
}

function isPathAtOrBelow(pathname: string, path: IdeallPath): boolean {
  return pathname === path || pathname.startsWith(`${path}/`)
}

export function capabilitySurfaceForPath(pathname: string): CapabilitySurface | null {
  return (
    CAPABILITY_SURFACES.find((surface) => isPathAtOrBelow(pathname, surface.navigationPath)) ??
    CAPABILITY_SURFACES.find((surface) =>
      surface.legacyPaths.some((path) => isPathAtOrBelow(pathname, path)),
    ) ??
    null
  )
}
