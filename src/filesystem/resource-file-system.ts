import {
  DIRECTORY_MEDIA_TYPE,
  fileRefKey,
  isFileRef,
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
  createResource,
  getResources,
  getVfsProvider,
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
  FileReadManyOptions,
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
import { base64ToBytes, bytesToBase64 } from "@/lib/base64"
import { countTrashItems } from "@/files/stores/trash-store"
import {
  remoteCommunityDirectoryRef,
  remoteInfoDirectoryRef,
  remoteServerFileSystem,
} from "./remote-server-file-system"
import { withFileWriteLock } from "./write-lock"

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
  layout?: "padded" | "fill"
  mediaType?: string
  params?: Readonly<Record<string, string>>
  properties?: Readonly<Record<string, unknown>>
}

const AI_TASKS_PANEL_ID_PREFIX = "ai-tasks:"
const MAX_PANEL_PARAMETER_LENGTH = 256

const PANELS: Record<CorePlaceId, readonly PanelFile[]> = {
  home: [{ id: "home", name: "Home", tabKind: "home-overview", module: "home" }],
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
  id?: string
  kinds?: readonly string[]
  rootOnly?: boolean
}

const PLACE_RESOURCE_QUERIES: Partial<Record<CorePlaceId, readonly PlaceResourceQuery[]>> = {
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
      panelLayout: panel.layout ?? "padded",
      ...(panel.params ? { params: { ...panel.params } } : {}),
      ...panel.properties,
    },
  }
}

function placeFile(place: CorePlaceId): IdeallFile {
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
      ...(placeCanWatch(place) ? (["watch"] as const) : []),
    ],
    source: CORE_SOURCE,
    properties: { place, rootChild: true },
  }
}

function isScopedEngineAccess(ref: FileRef, ctx: FileSystemAccessContext): boolean {
  return (
    ctx.actor === "engine" &&
    ctx.activeFile != null &&
    sameFileRef(ref, ctx.activeFile) &&
    (ctx.intent === "metadata" || ctx.intent === "content" || ctx.intent === "write")
  )
}

function toVfsContext(ctx: FileSystemAccessContext, target: FileRef | null, intent = ctx.intent) {
  const activeResource = ctx.activeFile ? resourceRefForFile(ctx.activeFile) : null
  const actor =
    ctx.actor === "ui" || (target != null && isScopedEngineAccess(target, ctx))
      ? ("ui" as const)
      : ctx.actor === "embed"
        ? ("embed" as const)
        : ("agent" as const)
  return {
    actor,
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

function hasPermission(ctx: FileSystemAccessContext, permission: string): boolean {
  return ctx.permissions.includes(permission)
}

function assertIntent(ctx: FileSystemAccessContext, intent: "write" | "action", ref: FileRef) {
  if (ctx.actor !== "ui" && ctx.intent !== intent) {
    throw new FileSystemError(
      "permission-denied",
      `The ${ctx.actor} actor requires ${intent} intent`,
      ref,
    )
  }
}

function assertCanWrite(ref: FileRef, ctx: FileSystemAccessContext): void {
  assertIntent(ctx, "write", ref)
  if (
    ctx.actor === "ui" ||
    isScopedEngineAccess(ref, ctx) ||
    hasPermission(ctx, "fs:write") ||
    hasPermission(ctx, "fs.notes:write")
  ) {
    return
  }
  throw new FileSystemError("permission-denied", "Missing write permission", ref)
}

function assertCanInvoke(ref: FileRef, action: string, ctx: FileSystemAccessContext): void {
  assertIntent(ctx, "action", ref)
  if (ctx.actor === "ui") return

  const activeEngine =
    ctx.actor === "engine" && ctx.activeFile != null && sameFileRef(ref, ctx.activeFile)
  if (["open", "preview", "navigate"].includes(action)) {
    if (activeEngine || hasPermission(ctx, "fs:read")) return
  } else if (action === "save-to-mine") {
    if (
      hasPermission(ctx, "hub.bookmarks:write") ||
      hasPermission(ctx, "hub.subscriptions:write")
    ) {
      return
    }
  } else if (hasPermission(ctx, "fs:write") || hasPermission(ctx, "fs.notes:write")) {
    return
  }
  throw new FileSystemError("permission-denied", `Missing permission for action: ${action}`, ref)
}

function assertCanListActions(ref: FileRef, ctx: FileSystemAccessContext): void {
  assertIntent(ctx, "action", ref)
  if (
    ctx.actor === "ui" ||
    (ctx.actor === "engine" && ctx.activeFile != null && sameFileRef(ref, ctx.activeFile)) ||
    hasPermission(ctx, "fs:read")
  ) {
    return
  }
  throw new FileSystemError("permission-denied", "Missing fs:read permission", ref)
}

function versionForResource(meta: ResourceMeta): string | undefined {
  return meta.updatedAt == null ? undefined : String(meta.updatedAt)
}

function assertExpectedVersion(
  ref: FileRef,
  expectedVersion: string | null | undefined,
  currentVersion: string | undefined,
): void {
  if (expectedVersion === undefined) return
  if (expectedVersion === (currentVersion ?? null)) return
  throw new FileSystemError(
    "conflict",
    `File version changed (expected ${expectedVersion ?? "no version"}, current ${currentVersion ?? "no version"})`,
    ref,
  )
}

function normalizeRange(
  ref: FileRef,
  range: NonNullable<FileReadOptions["range"]>,
): { start: number; end?: number } {
  const { start, end } = range
  if (
    !Number.isSafeInteger(start) ||
    start < 0 ||
    (end != null && (!Number.isSafeInteger(end) || end < start))
  ) {
    throw new FileSystemError("invalid-input", "Invalid read range", ref)
  }
  return { start, ...(end == null ? {} : { end }) }
}

function rangeReadData(
  ref: FileRef,
  data: unknown,
  range: FileReadOptions["range"],
): { data: unknown; size?: number } {
  if (!range) return { data }
  const { start, end } = normalizeRange(ref, range)
  if (data instanceof Blob) {
    const blob = data.slice(start, end)
    return { data: blob, size: blob.size }
  }
  if (typeof data === "string") {
    const bytes = new TextEncoder().encode(data).slice(start, end)
    return { data: new TextDecoder().decode(bytes), size: bytes.byteLength }
  }
  if (data instanceof ArrayBuffer) {
    const value = data.slice(start, end)
    return { data: value, size: value.byteLength }
  }
  if (ArrayBuffer.isView(data)) {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice(start, end)
    return { data: bytes, size: bytes.byteLength }
  }
  if (
    data != null &&
    typeof data === "object" &&
    "base64" in data &&
    typeof data.base64 === "string"
  ) {
    const bytes = base64ToBytes(data.base64).slice(start, end)
    return {
      data: { ...data, base64: bytesToBase64(bytes), size: bytes.byteLength },
      size: bytes.byteLength,
    }
  }
  throw new FileSystemError("unsupported", "Read ranges require byte-addressable content", ref)
}

function queryCanWatch(query: PlaceResourceQuery): boolean {
  if (!getVfsProvider(query.scheme)?.watch) return false
  if (query.scheme === "app" || query.scheme === "tool") return false
  return true
}

function placeCanWatch(place: CorePlaceId): boolean {
  return (PLACE_RESOURCE_QUERIES[place] ?? []).some(queryCanWatch)
}

function resourceCanWatch(ref: ResourceRef): boolean {
  return queryCanWatch({ scheme: ref.scheme, kinds: [ref.kind] })
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
  const projectedSortKey = file.properties?.sortKey
  return {
    entryId: fileRefKey(file.ref),
    parent,
    target: file.ref,
    name: file.name,
    kind: "link",
    file,
    sortKey:
      typeof projectedSortKey === "string" ? projectedSortKey : String(index).padStart(5, "0"),
    properties: {
      ...file.properties,
      mediaType: file.mediaType,
      capabilities: [...file.capabilities],
      createdAt: file.createdAt ?? null,
      updatedAt: file.updatedAt ?? null,
      version: file.version ?? null,
    },
  }
}

async function listPlaceFiles(
  place: CorePlaceId,
  ctx: FileSystemAccessContext,
  recursive = false,
): Promise<IdeallFile[]> {
  const files = PANELS[place].map(fileFromPanel)
  const remoteRef =
    place === "info"
      ? remoteInfoDirectoryRef
      : place === "community"
        ? remoteCommunityDirectoryRef
        : null
  if (remoteRef) {
    const remoteDirectory = await remoteServerFileSystem.stat(remoteRef, ctx)
    if (remoteDirectory) files.push(remoteDirectory)
  }
  for (const query of PLACE_RESOURCE_QUERIES[place] ?? []) {
    const result = await listResources(
      { scheme: query.scheme, kinds: query.kinds },
      toVfsContext(ctx, null, "directory"),
    )
    const metas = result.items.filter((meta) => recursive || !query.rootOnly || !meta.parent)
    // 递归投影由 FilesPort 随后按页 readMany 取正文；这里保留摘要 snapshot 即可，避免每个
    // cursor 页都先把整个 place 的完整节点再批读一次。普通目录仍提供完整安全 metadata。
    const records = recursive
      ? metas.map(() => null)
      : await getResources(
          metas.map((meta) => meta.ref),
          toVfsContext(ctx, null, "metadata"),
        )
    files.push(...metas.map((meta, index) => fileFromResource(meta, records[index] ?? null)))
  }
  const seen = new Set<string>()
  return files.filter((file) => {
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
    toVfsContext(ctx, resourceFileRef(resource), "directory"),
  )
  // 精确授权到父目录的 Engine 只能取得 list 已返回的安全摘要，不能借批量 metadata
  // 把 activeFile 的 UI 等价授权扩散到每个子文件。
  const records =
    ctx.actor === "engine"
      ? result.items.map(() => null)
      : await getResources(
          result.items.map((meta) => meta.ref),
          toVfsContext(ctx, resourceFileRef(resource), "metadata"),
        )
  return result.items.map((meta, index) => fileFromResource(meta, records[index] ?? null))
}

function recordReadResult(
  ref: FileRef,
  resource: ResourceRef,
  record: ResourceRecord,
  options?: FileReadOptions,
): FileReadResult {
  const ranged = rangeReadData(ref, record.content, options?.range)
  return {
    data: ranged.data,
    mediaType:
      resource.scheme === "node" && resource.kind === "file"
        ? inferredFileMediaType(record.meta.title, mediaTypeForResource(resource, record))
        : mediaTypeForResource(resource, record),
    size:
      ranged.size ??
      ((record.content as Node | undefined)?.kind === "file"
        ? (record.content as Extract<Node, { kind: "file" }>).blobRef.size
        : undefined),
    version: versionForResource(record.meta),
  }
}

async function readCoreFile(
  ref: FileRef,
  ctx: FileSystemAccessContext,
  options?: FileReadOptions,
): Promise<FileReadResult> {
  const place = placeForFile(ref)
  if (place) return { data: { place }, mediaType: DIRECTORY_MEDIA_TYPE }
  const panel = panelForFile(ref)
  if (panel) return { data: { ...panel }, mediaType: fileFromPanel(panel).mediaType }
  const resource = resourceRefForFile(ref)
  if (!resource) throw new FileSystemError("not-found", `File not found: ${fileRefKey(ref)}`, ref)
  try {
    if (
      resource.scheme === "node" &&
      resource.kind === "file" &&
      (options?.encoding === "binary" || options?.encoding === "text" || options?.range)
    ) {
      const data = await invokeResourceAction(
        resource,
        "read-blob",
        undefined,
        toVfsContext(ctx, ref, "content"),
      )
      const record = await getResource(resource, toVfsContext(ctx, ref, "metadata"))
      const ranged = rangeReadData(ref, data, options?.range)
      return {
        data: ranged.data,
        mediaType: inferredFileMediaType(
          record?.meta.title ?? resource.id,
          mediaTypeForResource(resource, record),
        ),
        size:
          ranged.size ??
          (data != null && typeof data === "object" && "size" in data
            ? Number(data.size)
            : undefined),
        version: record ? versionForResource(record.meta) : undefined,
      }
    }
    const record = await getResource(resource, toVfsContext(ctx, ref, "content"))
    if (!record) throw new FileSystemError("not-found", `File not found: ${fileRefKey(ref)}`, ref)
    return recordReadResult(ref, resource, record, options)
  } catch (error) {
    rethrowFileSystemError(error, ref)
  }
}

export function createResourceFileSystem(): FileSystemProvider {
  const descriptor: FileSystemDescriptor = {
    fileSystemId: CORE_FILE_SYSTEM_ID,
    name: "ideall core",
    root: coreRootRef(),
    source: CORE_SOURCE,
    capabilities: ["read-directory", "read", "write", "create", "actions", "watch"],
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
          capabilities: ["read-directory", "read", "actions"],
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
        const record = await getResource(resource, toVfsContext(ctx, ref, "metadata"))
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
        if (place) files = await listPlaceFiles(place, ctx, options.recursive === true)
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
          const projectedParent =
            options.recursive === true && isFileRef(file.properties?.parentRef)
              ? file.properties.parentRef
              : ref
          const next = entry(projectedParent, file, index)
          if (placeForFile(ref) === "browser" && file.properties?.resourceKind === "bookmark") {
            return { ...next, properties: { preferredEngine: "ideall.browser" } }
          }
          return next
        }),
        nextCursor: result.nextCursor,
      }
    },
    async read(ref, ctx, options?: FileReadOptions): Promise<FileReadResult> {
      return readCoreFile(ref, ctx, options)
    },
    async readMany(
      refs,
      ctx,
      options: FileReadManyOptions = {},
    ): Promise<Array<FileReadResult | null>> {
      if (refs.length === 0) return []
      const concurrency = options.concurrency ?? 4
      if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 32) {
        throw new FileSystemError(
          "invalid-input",
          "Read concurrency must be an integer between 1 and 32",
        )
      }
      const readOptions: FileReadOptions = {
        ...(options.encoding ? { encoding: options.encoding } : {}),
        ...(options.range ? { range: options.range } : {}),
      }
      const results = new Array<FileReadResult | null>(refs.length).fill(null)
      const resources: Array<{ ref: FileRef; resource: ResourceRef; index: number }> = []
      const singleReads: Array<{ ref: FileRef; index: number }> = []

      refs.forEach((ref, index) => {
        const place = placeForFile(ref)
        if (place) {
          results[index] = { data: { place }, mediaType: DIRECTORY_MEDIA_TYPE }
          return
        }
        const panel = panelForFile(ref)
        if (panel) {
          results[index] = { data: { ...panel }, mediaType: fileFromPanel(panel).mediaType }
          return
        }
        const resource = resourceRefForFile(ref)
        if (!resource) return
        const requiresSingleRead =
          ctx.actor === "engine" ||
          (resource.scheme === "node" &&
            resource.kind === "file" &&
            (options.encoding === "binary" || options.encoding === "text" || options.range != null))
        if (requiresSingleRead) singleReads.push({ ref, index })
        else resources.push({ ref, resource, index })
      })

      if (resources.length > 0) {
        try {
          const records = await getResources(
            resources.map((item) => item.resource),
            toVfsContext(ctx, null, "content"),
            concurrency,
          )
          resources.forEach((item, index) => {
            const record = records[index]
            results[item.index] = record
              ? recordReadResult(item.ref, item.resource, record, readOptions)
              : null
          })
        } catch (error) {
          rethrowFileSystemError(error, resources[0]?.ref ?? refs[0]!)
        }
      }

      // Blob/range 与 engine-scoped 授权必须逐项保留原 read 语义；串行即并发上限 1。
      for (const item of singleReads) {
        try {
          results[item.index] = await readCoreFile(item.ref, ctx, readOptions)
        } catch (error) {
          if (error instanceof FileSystemError && error.code === "not-found") continue
          throw error
        }
      }
      return results
    },
    async write(ref, input: FileWriteInput, ctx) {
      const resource = resourceRefForFile(ref)
      if (!resource) throw new FileSystemError("unsupported", "System panel is not writable", ref)
      try {
        assertCanWrite(ref, ctx)
        return await withFileWriteLock(ref, async () => {
          const current = await getResource(resource, toVfsContext(ctx, ref, "metadata"))
          if (!current)
            throw new FileSystemError("not-found", `File not found: ${fileRefKey(ref)}`, ref)
          assertExpectedVersion(ref, input.expectedVersion, versionForResource(current.meta))
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
              toVfsContext(ctx, ref, "write"),
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
            toVfsContext(ctx, ref, "write"),
          )
          const next = await this.stat(ref, ctx)
          if (!next)
            throw new FileSystemError("not-found", `File not found: ${fileRefKey(ref)}`, ref)
          return next
        })
      } catch (error) {
        rethrowFileSystemError(error, ref)
      }
    },
    async actions(ref, ctx): Promise<FileAction[]> {
      const resource = resourceRefForFile(ref)
      assertCanListActions(ref, ctx)
      if (!resource) {
        const place = placeForFile(ref)
        return place === "home" ||
          place === "subscriptions" ||
          place === "notes" ||
          place === "bookmarks" ||
          place === "files"
          ? [
              { id: "open", label: "打开", kind: "display" },
              {
                id: "create",
                label:
                  place === "home"
                    ? "新建对话"
                    : place === "subscriptions"
                      ? "新增关注"
                      : place === "notes"
                        ? "新建页面"
                        : place === "bookmarks"
                          ? "新增书签"
                          : "添加文件",
                requires: ["create"],
                kind: "specialized",
                reason: "需由对应内容界面收集创建参数",
              },
            ]
          : [{ id: "open", label: "打开", kind: "display" }]
      }
      try {
        const actions = await resourceActions(resource, toVfsContext(ctx, ref, "action"))
        return actions.map((action): FileAction => {
          const base = {
            id: action.id,
            label: action.label,
            risk: action.destructive ? ("destructive" as const) : ("safe" as const),
            requires: action.requires?.map((capability) => `resource:${capability}`),
          }
          if (action.invocation === "display") return { ...base, kind: "display" }
          if (action.invocation === "parameterless") {
            return { ...base, kind: "invoke", idempotent: false }
          }
          return {
            ...base,
            kind: "specialized",
            reason: "需由对应内容界面提供参数",
          }
        })
      } catch (error) {
        rethrowFileSystemError(error, ref)
      }
    },
    async invoke(ref, action, input, ctx) {
      const panel = panelForFile(ref)
      if (panel && action === "open") {
        assertCanInvoke(ref, action, ctx)
        return { panel }
      }
      const place = placeForFile(ref)
      if (place && placeFile(place).capabilities.includes("create") && action === "create") {
        assertCanInvoke(ref, action, ctx)
        try {
          const raw =
            input != null && typeof input === "object" && !Array.isArray(input)
              ? (input as Record<string, unknown>)
              : {}
          const requestedKind =
            place === "home"
              ? "thread"
              : place === "subscriptions"
                ? "feed"
                : place === "notes"
                  ? "note"
                  : place === "files"
                    ? "file"
                    : raw.kind === "folder"
                      ? "folder"
                      : "bookmark"
          const parentId =
            requestedKind === "bookmark" && typeof raw.parentId === "string" ? raw.parentId : null
          const created = await createResource(
            "node",
            { ...raw, kind: requestedKind, parentId },
            toVfsContext(ctx, ref, "action"),
          )
          const file = fileFromResource(created.meta, created)
          return { ref: file.ref, file }
        } catch (error) {
          rethrowFileSystemError(error, ref)
        }
      }
      const resource = resourceRefForFile(ref)
      if (!resource) throw new FileSystemError("unsupported", `Unsupported action: ${action}`, ref)
      try {
        assertCanInvoke(ref, action, ctx)
        if (
          action === "create" &&
          resource.scheme === "node" &&
          (resource.kind === "note" || resource.kind === "folder")
        ) {
          const created = (await invokeResourceAction(
            resource,
            "create",
            input,
            toVfsContext(ctx, ref, "action"),
          )) as ResourceRecord
          const file = fileFromResource(created.meta, created)
          return { ref: file.ref, file }
        }
        return await invokeResourceAction(
          resource,
          action as never,
          input,
          toVfsContext(ctx, ref, "action"),
        )
      } catch (error) {
        rethrowFileSystemError(error, ref)
      }
    },
    watch(ref, ctx, notify): FileSystemWatchHandle | null {
      const place = placeForFile(ref)
      const resource = resourceRefForFile(ref)
      const queries: PlaceResourceQuery[] = place
        ? [...(PLACE_RESOURCE_QUERIES[place] ?? [])]
        : resource
          ? [{ scheme: resource.scheme, id: resource.id, kinds: [resource.kind] }]
          : []
      const handles = queries.flatMap((query) => {
        if (!queryCanWatch(query)) return []
        try {
          const handle = watchResources(
            { scheme: query.scheme, id: query.id, kinds: query.kinds },
            toVfsContext(ctx, ref, "watch"),
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
