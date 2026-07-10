import {
  DIRECTORY_MEDIA_TYPE,
  fileRefKey,
  sameFileRef,
  type DirectoryEntry,
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
  type ResourceScheme,
} from "@protocol/resource"
import type { Node } from "@protocol/node"
import {
  getResource,
  invokeResourceAction,
  listResources,
  resourceActions,
  watchResources,
} from "@/vfs/registry"
import { VfsError } from "@/vfs/types"
import type {
  DirectoryPage,
  FileAction,
  FileReadOptions,
  FileReadResult,
  FileSystemAccessContext,
  FileSystemDescriptor,
  FileSystemProvider,
  FileSystemWatchEvent,
  FileSystemWatchHandle,
  FileWriteInput,
  ReadDirectoryOptions,
} from "./types"
import { FileSystemError } from "./types"
import { fileTypeInfo } from "@/lib/file-type"
import { countTrashItems } from "@/files/stores/trash-store"

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
  "tool",
  "browser",
  "system",
] as const

export type CorePlaceId = (typeof CORE_PLACE_IDS)[number]

type PanelFile = {
  id: string
  name: string
  tabKind: string
  module: string
  mediaType?: string
  properties?: Readonly<Record<string, unknown>>
}

const PANELS: Record<CorePlaceId, readonly PanelFile[]> = {
  home: [{ id: "home", name: "Home", tabKind: "home-overview", module: "home" }],
  subscriptions: [
    { id: "subscriptions", name: "关注流", tabKind: "subscriptions", module: "subscriptions" },
  ],
  bookmarks: [{ id: "bookmarks", name: "书签管理", tabKind: "home-bookmarks", module: "home" }],
  files: [{ id: "files", name: "文件管理", tabKind: "home-resources", module: "home" }],
  notes: [{ id: "notes", name: "笔记", tabKind: "home-notes", module: "home" }],
  workspace: [
    { id: "ai-settings", name: "AI 设置", tabKind: "ai-settings", module: "agent" },
    { id: "ai-mcp", name: "MCP", tabKind: "ai-mcp", module: "agent" },
    { id: "ai-skills", name: "Skills", tabKind: "ai-skills", module: "agent" },
    { id: "ai-rules", name: "规则", tabKind: "ai-rules", module: "agent" },
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
    },
    {
      id: "git",
      name: "Git",
      tabKind: "git",
      module: "git",
      mediaType: "application/vnd.ideall.git+json",
      properties: { git: true },
    },
    {
      id: "database",
      name: "数据库",
      tabKind: "database",
      module: "database",
      mediaType: "application/vnd.ideall.database+json",
    },
    {
      id: "audio",
      name: "音频",
      tabKind: "audio",
      module: "audio",
      mediaType: "application/vnd.ideall.audio+json",
    },
    { id: "code", name: "Code", tabKind: "code", module: "code" },
    { id: "trash", name: "回收站", tabKind: "trash", module: "trash" },
  ],
}

const PLACE_NAMES: Record<CorePlaceId, string> = {
  home: "Home",
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

type PlaceResourceQuery = {
  scheme: ResourceScheme
  kinds?: readonly string[]
  rootOnly?: boolean
}

const PLACE_RESOURCE_QUERIES: Partial<Record<CorePlaceId, readonly PlaceResourceQuery[]>> = {
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

const CORE_SOURCE: FileSource = { kind: "system", id: "ideall", label: "ideall" }

export function coreRootRef(): FileRef {
  return { fileSystemId: CORE_FILE_SYSTEM_ID, fileId: CORE_ROOT_FILE_ID }
}

export function corePlaceRef(place: CorePlaceId): FileRef {
  return { fileSystemId: CORE_FILE_SYSTEM_ID, fileId: `place:${place}` }
}

export function panelFileRef(panelId: string): FileRef {
  return { fileSystemId: CORE_FILE_SYSTEM_ID, fileId: `panel:${panelId}` }
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
  return (
    Object.values(PANELS)
      .flat()
      .find((panel) => panel.id === id) ?? null
  )
}

function placeForFile(ref: FileRef): CorePlaceId | null {
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

function mediaTypeForResource(ref: ResourceRef, record?: ResourceRecord | null): string {
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

function inferredFileMediaType(name: string, current: string): string {
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
    } else if (capability === "edit") result.add("write")
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

function fileFromResource(meta: ResourceMeta, record?: ResourceRecord | null): IdeallFile {
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
      "watch",
    ],
    source: sourceForResource(meta.ref),
    size: node?.kind === "file" ? node.blobRef.size : undefined,
    updatedAt: meta.updatedAt,
    properties: {
      resourceKey: resourceKey(meta.ref),
      resourceScheme: meta.ref.scheme,
      resourceKind: meta.ref.kind,
      route: meta.route ?? null,
      iconHint: meta.iconHint ?? null,
      url: url ?? null,
    },
  }
}

function fileFromPanel(panel: PanelFile): IdeallFile {
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
      ...panel.properties,
    },
  }
}

function placeFile(place: CorePlaceId): IdeallFile {
  return {
    ref: corePlaceRef(place),
    kind: "directory",
    name: PLACE_NAMES[place],
    mediaType: DIRECTORY_MEDIA_TYPE,
    capabilities: ["read-directory", "read", "watch", "actions"],
    source: CORE_SOURCE,
    properties: { place, rootChild: true },
  }
}

function toVfsContext(ctx: FileSystemAccessContext, intent = ctx.intent) {
  const activeResource = ctx.activeFile ? resourceRefForFile(ctx.activeFile) : null
  return {
    actor: ctx.actor === "engine" || ctx.actor === "system" ? ("ui" as const) : ctx.actor,
    permissions: ctx.permissions,
    activeRef: activeResource ?? undefined,
    intent:
      intent === "content" || intent === "write"
        ? ("content" as const)
        : intent === "action"
          ? ("action" as const)
          : ("metadata" as const),
  }
}

function rethrowFileSystemError(error: unknown, ref: FileRef): never {
  if (error instanceof VfsError) {
    const code = error.code === "unsupported" ? "unsupported" : error.code
    throw new FileSystemError(code, error.message, ref)
  }
  throw error
}

function page<T>(items: T[], options: ReadDirectoryOptions): { items: T[]; nextCursor?: string } {
  const rawOffset = options.cursor == null ? 0 : Number.parseInt(options.cursor, 10)
  if (!Number.isFinite(rawOffset) || rawOffset < 0) {
    throw new FileSystemError("invalid-input", `Invalid cursor: ${options.cursor}`)
  }
  const limit = options.limit == null ? items.length : Math.max(1, Math.floor(options.limit))
  const next = rawOffset + limit
  return {
    items: items.slice(rawOffset, next),
    nextCursor: next < items.length ? String(next) : undefined,
  }
}

function entry(parent: FileRef, file: IdeallFile, index: number): DirectoryEntry {
  return {
    entryId: `${index}:${fileRefKey(file.ref)}`,
    parent,
    target: file.ref,
    name: file.name,
    kind: "link",
    sortKey: String(index).padStart(5, "0"),
  }
}

async function listPlaceFiles(
  place: CorePlaceId,
  ctx: FileSystemAccessContext,
): Promise<IdeallFile[]> {
  const panels = PANELS[place].map(fileFromPanel)
  const pages = await Promise.all(
    (PLACE_RESOURCE_QUERIES[place] ?? []).map(async (query) => {
      const result = await listResources(
        { scheme: query.scheme, kinds: query.kinds },
        toVfsContext(ctx, "directory"),
      )
      return Promise.all(
        result.items
          .filter((meta) => !query.rootOnly || !meta.parent)
          .map(async (meta) => {
            const record = await getResource(meta.ref, toVfsContext(ctx, "metadata")).catch(
              () => null,
            )
            return fileFromResource(meta, record)
          }),
      )
    }),
  )
  const seen = new Set<string>()
  return [...panels, ...pages.flat()].filter((file) => {
    const key = fileRefKey(file.ref)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function listResourceChildren(
  resource: ResourceRef,
  ctx: FileSystemAccessContext,
): Promise<IdeallFile[]> {
  if (resource.scheme !== "node" || (resource.kind !== "folder" && resource.kind !== "note")) {
    throw new FileSystemError("unsupported", "File is not a directory", resourceFileRef(resource))
  }
  const kinds = resource.kind === "note" ? ["note"] : ["folder", "bookmark"]
  const result = await listResources(
    { scheme: "node", kinds, parent: resource },
    toVfsContext(ctx, "directory"),
  )
  return Promise.all(
    result.items.map(async (meta) => {
      const record = await getResource(meta.ref, toVfsContext(ctx, "metadata")).catch(() => null)
      return fileFromResource(meta, record)
    }),
  )
}

export function createResourceFileSystem(): FileSystemProvider {
  const descriptor: FileSystemDescriptor = {
    fileSystemId: CORE_FILE_SYSTEM_ID,
    name: "ideall core",
    root: coreRootRef(),
    source: CORE_SOURCE,
    capabilities: ["read-directory", "read", "write", "actions", "watch"],
  }
  return {
    descriptor,
    async stat(ref, ctx) {
      if (sameFileRef(ref, descriptor.root)) {
        return {
          ref,
          kind: "directory",
          name: descriptor.name,
          mediaType: DIRECTORY_MEDIA_TYPE,
          capabilities: descriptor.capabilities ?? [],
          source: CORE_SOURCE,
          properties: { hidden: true },
        }
      }
      const place = placeForFile(ref)
      if (place) return placeFile(place)
      const panel = panelForFile(ref)
      if (panel) {
        const file = fileFromPanel(panel)
        if (panel.id !== "trash") return file
        try {
          return {
            ...file,
            properties: { ...file.properties, badge: await countTrashItems() },
          }
        } catch {
          return file
        }
      }
      const resource = resourceRefForFile(ref)
      if (!resource) return null
      try {
        const record = await getResource(resource, toVfsContext(ctx, "metadata"))
        return record ? fileFromResource(record.meta, record) : null
      } catch (error) {
        // FileSystem.stat 以 null 表达目标不存在；旧 VFS provider 可能用 not-found 异常表达
        // 同一状态，适配边界在这里归一化，避免 Display 泄漏底层错误文案。
        if (error instanceof VfsError && error.code === "not-found") return null
        rethrowFileSystemError(error, ref)
      }
    },
    async readDirectory(ref, ctx, options = {}) {
      let files: IdeallFile[]
      if (sameFileRef(ref, descriptor.root)) {
        files = CORE_PLACE_IDS.map(placeFile)
      } else {
        const place = placeForFile(ref)
        if (place) files = await listPlaceFiles(place, ctx)
        else {
          const resource = resourceRefForFile(ref)
          if (!resource)
            throw new FileSystemError("not-found", `Directory not found: ${fileRefKey(ref)}`, ref)
          files = await listResourceChildren(resource, ctx)
        }
      }
      const result = page(files, options)
      return {
        entries: result.items.map((file, index) => {
          const next = entry(ref, file, index)
          if (placeForFile(ref) === "browser" && file.properties?.resourceKind === "bookmark") {
            return { ...next, properties: { preferredEngine: "ideall.browser" } }
          }
          return next
        }),
        nextCursor: result.nextCursor,
      }
    },
    async read(ref, ctx, options?: FileReadOptions): Promise<FileReadResult> {
      const place = placeForFile(ref)
      if (place) return { data: { place }, mediaType: DIRECTORY_MEDIA_TYPE }
      const panel = panelForFile(ref)
      if (panel) return { data: { ...panel }, mediaType: fileFromPanel(panel).mediaType }
      const resource = resourceRefForFile(ref)
      if (!resource)
        throw new FileSystemError("not-found", `File not found: ${fileRefKey(ref)}`, ref)
      try {
        if (
          resource.scheme === "node" &&
          resource.kind === "file" &&
          (options?.encoding === "binary" || options?.encoding === "text")
        ) {
          const data = await invokeResourceAction(
            resource,
            "read-blob",
            undefined,
            toVfsContext(ctx, "content"),
          )
          const record = await getResource(resource, toVfsContext(ctx, "metadata"))
          return {
            data,
            mediaType: inferredFileMediaType(
              record?.meta.title ?? resource.id,
              mediaTypeForResource(resource, record),
            ),
          }
        }
        const record = await getResource(resource, toVfsContext(ctx, "content"))
        if (!record)
          throw new FileSystemError("not-found", `File not found: ${fileRefKey(ref)}`, ref)
        return {
          data: record.content,
          mediaType:
            resource.scheme === "node" && resource.kind === "file"
              ? inferredFileMediaType(record.meta.title, mediaTypeForResource(resource, record))
              : mediaTypeForResource(resource, record),
          size:
            (record.content as Node | undefined)?.kind === "file"
              ? (record.content as Extract<Node, { kind: "file" }>).blobRef.size
              : undefined,
        }
      } catch (error) {
        rethrowFileSystemError(error, ref)
      }
    },
    async write(ref, input: FileWriteInput, ctx) {
      const resource = resourceRefForFile(ref)
      if (!resource) throw new FileSystemError("unsupported", "System panel is not writable", ref)
      try {
        if (resource.scheme === "node" && resource.kind === "file") {
          if (typeof input.data !== "string") {
            throw new FileSystemError(
              "unsupported",
              "Node file adapter currently supports text writes only",
              ref,
            )
          }
          await invokeResourceAction(
            resource,
            "write-blob",
            { content: input.data, mime: input.mediaType },
            toVfsContext(ctx, "write"),
          )
          const next = await this.stat(ref, ctx)
          if (!next)
            throw new FileSystemError("not-found", `File not found: ${fileRefKey(ref)}`, ref)
          return next
        }
        await invokeResourceAction(
          resource,
          "edit",
          typeof input.data === "object" && input.data !== null
            ? input.data
            : { content: input.data },
          toVfsContext(ctx, "write"),
        )
        const next = await this.stat(ref, ctx)
        if (!next) throw new FileSystemError("not-found", `File not found: ${fileRefKey(ref)}`, ref)
        return next
      } catch (error) {
        rethrowFileSystemError(error, ref)
      }
    },
    async actions(ref, ctx): Promise<FileAction[]> {
      const resource = resourceRefForFile(ref)
      if (!resource) return [{ id: "open", label: "打开" }]
      try {
        const actions = await resourceActions(resource, toVfsContext(ctx, "action"))
        return actions.map((action) => ({
          id: action.id,
          label: action.label,
          destructive: action.destructive,
          requires: action.requires?.map((capability) => `resource:${capability}`),
        }))
      } catch (error) {
        rethrowFileSystemError(error, ref)
      }
    },
    async invoke(ref, action, input, ctx) {
      const panel = panelForFile(ref)
      if (panel && action === "open") return { panel }
      const resource = resourceRefForFile(ref)
      if (!resource) throw new FileSystemError("unsupported", `Unsupported action: ${action}`, ref)
      try {
        return await invokeResourceAction(
          resource,
          action as never,
          input,
          toVfsContext(ctx, "action"),
        )
      } catch (error) {
        rethrowFileSystemError(error, ref)
      }
    },
    watch(ref, ctx, notify): FileSystemWatchHandle | null {
      const place = placeForFile(ref)
      if (!place) return null
      const handles = (PLACE_RESOURCE_QUERIES[place] ?? []).flatMap((query) => {
        try {
          const handle = watchResources(
            { scheme: query.scheme, kinds: query.kinds },
            toVfsContext(ctx, "watch"),
            () => {
              const event: FileSystemWatchEvent = { type: "changed", ref }
              notify(event)
            },
          )
          return handle ? [handle] : []
        } catch {
          return []
        }
      })
      return handles.length
        ? { dispose: () => handles.forEach((handle) => handle.dispose()) }
        : null
    },
  }
}

export const resourceFileSystem = createResourceFileSystem()
