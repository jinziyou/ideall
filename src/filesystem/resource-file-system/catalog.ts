import type { Node } from "@protocol/node"
import {
  DIRECTORY_MEDIA_TYPE,
  type FileCapability,
  type FileRef,
  type FileSource,
  type IdeallFile,
} from "@protocol/file-system"
import {
  parseResourceKey,
  resourceKey,
  type ResourceCapability,
  type ResourceMeta,
  type ResourceRecord,
  type ResourceRef,
} from "@protocol/resource"
import { fileTypeInfo } from "@/lib/file-type"
import { FileSystemError } from "../types"
import {
  queryCanWatch,
  resourceCanWatch,
  versionForResource,
  type PlaceResourceQuery,
} from "./policy"

export const CORE_FILE_SYSTEM_ID = "ideall.core"
export const CORE_ROOT_FILE_ID = "root"

export const CORE_PLACE_IDS = [
  "home",
  "subscriptions",
  "bookmarks",
  "files",
  "notes",
  "workspace",
  "apps",
  "info",
  "community",
  "browser",
  "tool",
  "system",
] as const

export type CorePlaceId = (typeof CORE_PLACE_IDS)[number]

export type PanelFile = {
  id: string
  name: string
  tabKind: string
  module: string
  layout?: "padded" | "fill"
  mediaType?: string
  params?: Readonly<Record<string, string>>
  properties?: Readonly<Record<string, unknown>>
}

const AI_TASKS_PANEL_ID_PREFIX = "ai-tasks:"
const MAX_PANEL_PARAMETER_LENGTH = 256

export const PANELS: Record<CorePlaceId, readonly PanelFile[]> = {
  home: [{ id: "home", name: "我的", tabKind: "home-overview", module: "home" }],
  subscriptions: [
    { id: "subscriptions", name: "关注流", tabKind: "subscriptions", module: "subscriptions" },
  ],
  bookmarks: [{ id: "bookmarks", name: "书签管理", tabKind: "home-bookmarks", module: "home" }],
  files: [{ id: "files", name: "文件管理", tabKind: "home-resources", module: "home" }],
  notes: [{ id: "notes", name: "笔记", tabKind: "home-notes", module: "home" }],
  workspace: [
    {
      id: "ai-settings",
      name: "AI 设置",
      tabKind: "ai-settings",
      module: "agent",
      layout: "fill",
    },
    { id: "ai-mcp", name: "MCP", tabKind: "ai-mcp", module: "agent", layout: "fill" },
    {
      id: "ai-skills",
      name: "Skills",
      tabKind: "ai-skills",
      module: "agent",
      layout: "fill",
    },
    { id: "ai-rules", name: "规则", tabKind: "ai-rules", module: "agent", layout: "fill" },
  ],
  apps: [{ id: "apps", name: "应用", tabKind: "apps", module: "apps" }],
  info: [],
  community: [
    {
      id: "publications",
      name: "我的发布",
      tabKind: "home-publications",
      module: "publications",
    },
  ],
  tool: [],
  browser: [],
  system: [
    { id: "settings", name: "设置", tabKind: "home-settings", module: "home" },
    {
      id: "shell",
      name: "终端",
      tabKind: "shell",
      module: "shell",
      mediaType: "application/vnd.ideall.shell+json",
      properties: { navigationHidden: true },
    },
    // Git / 数据库 / 音频由各自 App FileSystem root 直接进入 Display。旧 panel:* 身份
    // 只在 workspace 水合边界迁移，不再作为 ideall.core 下的新导航文件暴露。
    { id: "code", name: "Code", tabKind: "code", module: "code" },
    { id: "trash", name: "回收站", tabKind: "trash", module: "trash" },
  ],
}

const PLACE_NAMES: Record<CorePlaceId, string> = {
  home: "我的",
  subscriptions: "关注",
  bookmarks: "书签",
  files: "文件",
  notes: "笔记",
  workspace: "工作区",
  apps: "应用",
  info: "资讯",
  community: "社区",
  tool: "工具",
  browser: "浏览器",
  system: "系统",
}

export const PLACE_RESOURCE_QUERIES: Partial<Record<CorePlaceId, readonly PlaceResourceQuery[]>> = {
  // AI 对话仍是普通文件；内部 workspace 根只作旧 FileRef 兼容，导航从 Home 提供链接。
  home: [{ scheme: "node", kinds: ["thread"], rootOnly: true }],
  subscriptions: [{ scheme: "node", kinds: ["feed"] }],
  bookmarks: [{ scheme: "node", kinds: ["folder", "bookmark"], rootOnly: true }],
  files: [{ scheme: "node", kinds: ["file"] }],
  notes: [{ scheme: "node", kinds: ["note"], rootOnly: true }],
  workspace: [{ scheme: "node", kinds: ["thread"] }],
  apps: [{ scheme: "app" }],
  info: [{ scheme: "info" }],
  community: [{ scheme: "community" }],
  tool: [{ scheme: "tool" }],
  // 浏览器书签与「书签」目录引用同一个 node FileRef；目录项只改变默认显示引擎。
  browser: [{ scheme: "node", kinds: ["bookmark"], rootOnly: true }],
}

export const CORE_SOURCE: FileSource = { kind: "system", id: "ideall", label: "ideall" }

export function coreRootRef(): FileRef {
  return { fileSystemId: CORE_FILE_SYSTEM_ID, fileId: CORE_ROOT_FILE_ID }
}

export function corePlaceRef(place: CorePlaceId): FileRef {
  return { fileSystemId: CORE_FILE_SYSTEM_ID, fileId: `place:${place}` }
}

export function panelFileRef(panelId: string): FileRef {
  return { fileSystemId: CORE_FILE_SYSTEM_ID, fileId: `panel:${panelId}` }
}

/** AI 任务页的文件身份只由工作区 id 决定；标题变化不会产生第二个文件或标签。 */
export function aiTasksPanelFileRef(workspaceId: string): FileRef {
  if (
    !workspaceId ||
    workspaceId !== workspaceId.trim() ||
    workspaceId.length > MAX_PANEL_PARAMETER_LENGTH
  ) {
    throw new FileSystemError("invalid-input", "AI task panel requires a valid workspace id")
  }
  try {
    return panelFileRef(`${AI_TASKS_PANEL_ID_PREFIX}${encodeURIComponent(workspaceId)}`)
  } catch {
    throw new FileSystemError("invalid-input", "AI task panel workspace id cannot be encoded")
  }
}

export function resourceFileRef(ref: ResourceRef): FileRef {
  return {
    fileSystemId: CORE_FILE_SYSTEM_ID,
    fileId: `resource:${encodeURIComponent(resourceKey(ref))}`,
  }
}

export function resourceRefForFile(ref: FileRef): ResourceRef | null {
  if (ref.fileSystemId !== CORE_FILE_SYSTEM_ID || !ref.fileId.startsWith("resource:")) return null
  try {
    return parseResourceKey(decodeURIComponent(ref.fileId.slice("resource:".length)))
  } catch {
    return null
  }
}

export function panelForFile(ref: FileRef): PanelFile | null {
  if (ref.fileSystemId !== CORE_FILE_SYSTEM_ID || !ref.fileId.startsWith("panel:")) return null
  const id = ref.fileId.slice("panel:".length)
  const panel =
    Object.values(PANELS)
      .flat()
      .find((candidate) => candidate.id === id) ?? null
  if (panel) return panel
  if (!id.startsWith(AI_TASKS_PANEL_ID_PREFIX)) return null

  const encodedWorkspaceId = id.slice(AI_TASKS_PANEL_ID_PREFIX.length)
  try {
    const workspaceId = decodeURIComponent(encodedWorkspaceId)
    if (
      !workspaceId ||
      workspaceId !== workspaceId.trim() ||
      workspaceId.length > MAX_PANEL_PARAMETER_LENGTH ||
      encodeURIComponent(workspaceId) !== encodedWorkspaceId
    ) {
      return null
    }
    return {
      id,
      name: "任务",
      tabKind: "ai-tasks",
      module: "agent",
      layout: "fill",
      params: { workspaceId },
      properties: { workspaceId },
    }
  } catch {
    return null
  }
}

export function placeForFile(ref: FileRef): CorePlaceId | null {
  if (ref.fileSystemId !== CORE_FILE_SYSTEM_ID || !ref.fileId.startsWith("place:")) return null
  const place = ref.fileId.slice("place:".length)
  return (CORE_PLACE_IDS as readonly string[]).includes(place) ? (place as CorePlaceId) : null
}

function sourceForResource(ref: ResourceRef): FileSource {
  if (ref.scheme === "node") return { kind: "local", id: "ideall.nodes", label: "本机" }
  if (ref.scheme === "info" || ref.scheme === "community") {
    return { kind: "remote", id: ref.scheme, label: ref.scheme === "info" ? "资讯" : "社区" }
  }
  if (ref.scheme === "app") return { kind: "app", id: ref.id, label: "应用" }
  if (ref.scheme === "browser") return { kind: "app", id: "browser", label: "浏览器" }
  return { kind: "system", id: ref.scheme, label: ref.scheme }
}

export function mediaTypeForResource(ref: ResourceRef, record?: ResourceRecord | null): string {
  if (ref.scheme === "node") {
    switch (ref.kind) {
      case "folder":
        return DIRECTORY_MEDIA_TYPE
      case "note":
        return "application/vnd.ideall.note+json"
      case "bookmark":
        return "application/vnd.ideall.bookmark+json"
      case "file": {
        const node = record?.content as Node | undefined
        return node?.kind === "file"
          ? node.blobRef.mime || "application/octet-stream"
          : "application/octet-stream"
      }
      case "feed":
        return "application/vnd.ideall.feed+json"
      case "thread":
        return "application/vnd.ideall.thread+json"
    }
  }
  if (ref.scheme === "browser") return "text/uri-list"
  if (ref.scheme === "app") return "application/vnd.ideall.app+json"
  return `application/vnd.ideall.${ref.scheme}.${ref.kind}+json`
}

export function inferredFileMediaType(name: string, current: string): string {
  if (current && current !== "application/octet-stream" && current !== "application/unknown") {
    return current
  }
  const info = fileTypeInfo(name, current)
  if (info.preview === "audio") return "audio/*"
  if (info.preview === "video") return "video/*"
  if (info.preview === "image" || info.preview === "svg") return `image/${info.ext || "*"}`
  if (info.preview === "json") return "application/json"
  if (info.preview === "markdown") return "text/markdown"
  if (["code", "csv", "text"].includes(info.preview)) return "text/plain"
  if (info.preview === "pdf") return "application/pdf"
  return current || "application/octet-stream"
}

function capabilitiesForResource(capabilities: readonly ResourceCapability[]): FileCapability[] {
  const result = new Set<FileCapability>(["actions"])
  for (const capability of capabilities) {
    if (capability === "read-content" || capability === "read-blob" || capability === "open") {
      result.add("read")
    } else if (capability === "create") result.add("create")
    else if (capability === "edit") result.add("write")
    else if (capability === "move") result.add("move")
    else if (capability === "delete") result.add("delete")
    else if (capability === "save-to-mine") result.add("save-to-mine")
    result.add(`resource:${capability}`)
  }
  return [...result]
}

function resourceIsDirectory(ref: ResourceRef): boolean {
  return ref.scheme === "node" && (ref.kind === "folder" || ref.kind === "note")
}

export function fileFromResource(meta: ResourceMeta, record?: ResourceRecord | null): IdeallFile {
  const node = record?.content as Node | undefined
  const url =
    node?.kind === "bookmark"
      ? node.content.url
      : node?.kind === "feed" && node.content.type === "tool"
        ? node.content.key
        : undefined
  return {
    ref: resourceFileRef(meta.ref),
    kind: resourceIsDirectory(meta.ref) ? "directory" : "file",
    name: meta.title,
    mediaType:
      meta.ref.scheme === "node" && meta.ref.kind === "file"
        ? inferredFileMediaType(meta.title, mediaTypeForResource(meta.ref, record))
        : mediaTypeForResource(meta.ref, record),
    capabilities: [
      ...capabilitiesForResource(meta.capabilities),
      ...(resourceIsDirectory(meta.ref) ? (["read-directory"] as const) : []),
      ...(meta.ref.scheme === "node" && meta.ref.kind === "note" ? (["create"] as const) : []),
      ...(resourceCanWatch(meta.ref) ? (["watch"] as const) : []),
      ...(meta.ref.scheme === "node" ? (["standalone-window"] as const) : []),
    ],
    source: sourceForResource(meta.ref),
    size: node?.kind === "file" ? node.blobRef.size : undefined,
    createdAt: node?.createdAt,
    updatedAt: meta.updatedAt,
    version: versionForResource(meta),
    properties: {
      resourceKey: resourceKey(meta.ref),
      resourceScheme: meta.ref.scheme,
      resourceKind: meta.ref.kind,
      route: meta.route ?? null,
      iconHint: meta.iconHint ?? null,
      url: url ?? null,
      tags: node?.tags ?? [],
      parentId: meta.parent?.id ?? null,
      parentRef: meta.parent ? resourceFileRef(meta.parent) : null,
      sortKey: meta.sortKey ?? node?.sortKey ?? "",
      hasChildren: meta.hasChildren ?? false,
      subscriptionType: node?.kind === "feed" ? node.content.type : null,
      subscriptionKey: node?.kind === "feed" ? node.content.key : null,
    },
  }
}

export function fileFromPanel(panel: PanelFile): IdeallFile {
  return {
    ref: panelFileRef(panel.id),
    kind: "file",
    name: panel.name,
    mediaType: panel.mediaType ?? `application/vnd.ideall.panel.${panel.tabKind}+json`,
    capabilities: ["read", "actions"],
    source: CORE_SOURCE,
    properties: {
      panelId: panel.id,
      tabKind: panel.tabKind,
      module: panel.module,
      panelLayout: panel.layout ?? "padded",
      ...(panel.params ? { params: { ...panel.params } } : {}),
      ...panel.properties,
    },
  }
}

export function placeFile(place: CorePlaceId): IdeallFile {
  const canCreate =
    place === "home" ||
    place === "subscriptions" ||
    place === "notes" ||
    place === "bookmarks" ||
    place === "files"
  return {
    ref: corePlaceRef(place),
    kind: "directory",
    name: PLACE_NAMES[place],
    mediaType: DIRECTORY_MEDIA_TYPE,
    capabilities: [
      "read-directory",
      "read",
      "actions",
      ...(canCreate ? (["create"] as const) : []),
      ...(PLACE_RESOURCE_QUERIES[place]?.some(queryCanWatch) ? (["watch"] as const) : []),
    ],
    source: CORE_SOURCE,
    properties: { place, rootChild: true },
  }
}
