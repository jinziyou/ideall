import type { Node } from "@protocol/node"
import { resourceKey } from "@protocol/resource"
import {
  DIRECTORY_MEDIA_TYPE,
  fileRefKey,
  isFileRef,
  sameFileRef,
  type DirectoryEntry,
  type FileRef,
  type IdeallFile,
} from "@protocol/file-system"
import type { ResourceRecord, ResourceRef } from "@protocol/resource"
import {
  CAPTURE_BOOKMARK_ACTION,
  CAPTURE_BOOKMARK_DESCRIPTION_LIMIT,
  CAPTURE_BOOKMARK_FAVICON_LIMIT,
  CAPTURE_BOOKMARK_TITLE_LIMIT,
  CAPTURE_BOOKMARK_URL_LIMIT,
  CAPTURE_INBOX_TAG,
} from "@protocol/capture"
import { countTrashItems } from "@/files/stores/trash-store"
import { captureBookmark as captureBookmarkStore } from "@/files/stores/bookmarks-store"
import { AGENT_TASKS_FILE_REF } from "@/filesystem/builtin-app-roots"
import { canonicalHttpUrl } from "@/lib/canonical-http-url"
import {
  createResource,
  getResources,
  getResource,
  invokeResourceAction,
  listResources,
  resourceActions,
  watchResources,
} from "@/filesystem/resource-sources/registry"
import { ResourceSourceError } from "@/filesystem/resource-sources/types"
import {
  remoteCommunityDirectoryRef,
  remoteInfoDirectoryRef,
  remoteServerFileSystem,
} from "../remote-server-file-system"
import { paginateDirectoryItems } from "../provider-input"
import type {
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
} from "../types"
import { FileSystemError } from "../types"
import { withFileWriteLock } from "../write-lock"
import {
  CORE_FILE_SYSTEM_ID,
  CORE_PLACE_IDS,
  CORE_SOURCE,
  PANELS,
  PLACE_RESOURCE_QUERIES,
  coreRootRef,
  fileFromPanel,
  fileFromResource,
  inferredFileMediaType,
  mediaTypeForResource,
  panelForFile,
  placeFile,
  placeForFile,
  resourceFileRef,
  resourceRefForFile,
  type CorePlaceId,
} from "./catalog"
import {
  assertCanInvoke,
  assertCanListActions,
  assertCanWrite,
  assertExpectedVersion,
  queryCanWatch,
  rangeReadData,
  rethrowFileSystemError,
  toResourceSourceContext,
  versionForResource,
  type PlaceResourceQuery,
} from "./policy"

function boundedCaptureText(value: unknown, limit: number): string {
  if (typeof value !== "string") return ""
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= limit) return normalized
  return `${normalized.slice(0, Math.max(1, limit - 1)).trimEnd()}…`
}

function captureBookmarkInput(value: unknown): {
  title: string
  url: string
  description?: string
  favicon?: string
  tags: string[]
} {
  const raw =
    value != null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  const url = typeof raw.url === "string" ? raw.url.trim() : ""
  if (!url || url.length > CAPTURE_BOOKMARK_URL_LIMIT || !canonicalHttpUrl(url)) {
    throw new FileSystemError("unsupported", "捕获只支持有界 HTTP(S) 链接")
  }
  const title = boundedCaptureText(raw.title, CAPTURE_BOOKMARK_TITLE_LIMIT)
  const description = boundedCaptureText(raw.description, CAPTURE_BOOKMARK_DESCRIPTION_LIMIT)
  const faviconRaw =
    typeof raw.favicon === "string" && raw.favicon.length <= CAPTURE_BOOKMARK_FAVICON_LIMIT
      ? raw.favicon.trim()
      : ""
  const favicon = faviconRaw && canonicalHttpUrl(faviconRaw) ? faviconRaw : undefined
  return {
    title: title || new URL(url).hostname.replace(/^www\./i, "") || url,
    url,
    ...(description ? { description } : {}),
    ...(favicon ? { favicon } : {}),
    tags: [CAPTURE_INBOX_TAG],
  }
}

function sourceContext(
  ctx: FileSystemAccessContext,
  target: FileRef | null,
  intent = ctx.intent,
  expectedVersion?: string | null,
) {
  const activeResource = ctx.activeFile ? resourceRefForFile(ctx.activeFile) : null
  return {
    ...toResourceSourceContext(ctx, target, activeResource, intent),
    ...(expectedVersion !== undefined ? { expectedVersion } : {}),
  }
}

function isNodeThreadResource(resource: ResourceRef): boolean {
  return resource.scheme === "node" && resource.kind === "thread"
}

/**
 * Thread writes can advance the durable Agent task index as part of the same Storage mutation.
 * Keep the global dependency order tasks -> thread so task-only runtime mutations, Agent config
 * writes/imports, and generic thread mutations cannot observe or publish crossed revisions.
 */
function withThreadMutationWriteLocks<T>(
  ref: FileRef,
  operation: () => T | Promise<T>,
): Promise<T> {
  return withFileWriteLock(AGENT_TASKS_FILE_REF, () => withFileWriteLock(ref, operation))
}

/**
 * write 所调用的 mutation 必须返回本次事务实际提交的 ResourceRecord。直接消费该结果，
 * 避免提交后再次 stat 读到另一笔并发写入，或把已成功的提交误报为 not-found。
 */
function committedResourceRecord(
  expectedRef: ResourceRef,
  value: unknown,
  action: "edit" | "write-blob",
): ResourceRecord {
  try {
    if (
      value != null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      "meta" in value &&
      value.meta != null &&
      typeof value.meta === "object" &&
      "ref" in value.meta
    ) {
      const record = value as ResourceRecord
      if (resourceKey(record.meta.ref) === resourceKey(expectedRef)) return record
    }
  } catch {
    // 统一在下方报告 source 契约错误，避免泄漏畸形返回值的内部异常。
  }
  throw new ResourceSourceError(
    "unsupported",
    `Resource action ${action} did not return its committed record: ${resourceKey(expectedRef)}`,
  )
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

/** Home 二级树下挂载的本机资料目录 (活动栏不再单独占位)。 */
const HOME_NESTED_PLACES = ["bookmarks", "files", "notes"] as const satisfies readonly CorePlaceId[]

async function listPlaceFiles(
  place: CorePlaceId,
  ctx: FileSystemAccessContext,
  recursive = false,
): Promise<IdeallFile[]> {
  const files = PANELS[place].map(fileFromPanel)
  if (place === "home") {
    files.push(...HOME_NESTED_PLACES.map(placeFile))
  }
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
      sourceContext(ctx, null, "directory"),
    )
    const metas = result.items.filter((meta) => recursive || !query.rootOnly || !meta.parent)
    // 递归投影由 FilesPort 随后按页 readMany 取正文；这里保留摘要 snapshot 即可，避免每个
    // cursor 页都先把整个 place 的完整节点再批读一次。普通目录仍提供完整安全 metadata。
    const records = recursive
      ? metas.map(() => null)
      : await getResources(
          metas.map((meta) => meta.ref),
          sourceContext(ctx, null, "metadata"),
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
  options: ReadDirectoryOptions = {},
): Promise<{ files: IdeallFile[]; nextCursor?: string }> {
  if (resource.scheme !== "node" || (resource.kind !== "folder" && resource.kind !== "note")) {
    throw new FileSystemError("unsupported", "File is not a directory", resourceFileRef(resource))
  }
  const kinds = resource.kind === "note" ? ["note"] : ["folder", "bookmark"]
  const result = await listResources(
    {
      scheme: "node",
      kinds,
      parent: resource,
      ...(options.limit === undefined ? {} : { limit: options.limit }),
      ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
    },
    sourceContext(ctx, resourceFileRef(resource), "directory"),
  )
  // 精确授权到父目录的 Engine 只能取得 list 已返回的安全摘要，不能借批量 metadata
  // 把 activeFile 的 UI 等价授权扩散到每个子文件。
  const records =
    ctx.actor === "engine"
      ? result.items.map(() => null)
      : await getResources(
          result.items.map((meta) => meta.ref),
          sourceContext(ctx, resourceFileRef(resource), "metadata"),
        )
  return {
    files: result.items.map((meta, index) => fileFromResource(meta, records[index] ?? null)),
    ...(result.nextCursor === undefined ? {} : { nextCursor: result.nextCursor }),
  }
}

const PAGED_NODE_PLACES = new Set<CorePlaceId>([
  "subscriptions",
  "bookmarks",
  "files",
  "notes",
  "browser",
])
const NODE_PLACE_CURSOR_PREFIX = "node:"

function decodeNodePlaceCursor(ref: FileRef, cursor: string | undefined): string | undefined {
  if (cursor === undefined) return undefined
  if (!cursor.startsWith(NODE_PLACE_CURSOR_PREFIX)) {
    throw new FileSystemError("invalid-input", `Invalid node place cursor: ${cursor}`, ref)
  }
  const encoded = cursor.slice(NODE_PLACE_CURSOR_PREFIX.length)
  if (encoded === "start") return undefined
  try {
    return decodeURIComponent(encoded)
  } catch {
    throw new FileSystemError("invalid-input", `Invalid node place cursor: ${cursor}`, ref)
  }
}

function encodeNodePlaceCursor(cursor: string | undefined): string {
  return `${NODE_PLACE_CURSOR_PREFIX}${cursor === undefined ? "start" : encodeURIComponent(cursor)}`
}

async function listPagedNodePlace(
  place: CorePlaceId,
  ref: FileRef,
  ctx: FileSystemAccessContext,
  options: ReadDirectoryOptions,
): Promise<{ files: IdeallFile[]; nextCursor?: string } | null> {
  if (options.limit === undefined || options.recursive === true || !PAGED_NODE_PLACES.has(place)) {
    return null
  }
  if (!Number.isSafeInteger(options.limit) || options.limit < 1) {
    throw new FileSystemError("invalid-input", "Directory limit must be positive", ref)
  }
  const queries = PLACE_RESOURCE_QUERIES[place] ?? []
  const query = queries.length === 1 && queries[0]?.scheme === "node" ? queries[0] : null
  if (!query) return null

  const sourceCursor = decodeNodePlaceCursor(ref, options.cursor)
  const staticFiles = options.cursor === undefined ? PANELS[place].map(fileFromPanel) : []
  const sourceLimit = options.limit - staticFiles.length
  if (sourceLimit <= 0) {
    return {
      files: staticFiles.slice(0, options.limit),
      nextCursor: encodeNodePlaceCursor(undefined),
    }
  }
  const result = await listResources(
    {
      scheme: "node",
      kinds: query.kinds,
      ...(query.rootOnly ? { rootOnly: true } : {}),
      limit: sourceLimit,
      ...(sourceCursor === undefined ? {} : { cursor: sourceCursor }),
    },
    sourceContext(ctx, null, "directory"),
  )
  const records = await getResources(
    result.items.map((meta) => meta.ref),
    sourceContext(ctx, null, "metadata"),
  )
  return {
    files: [
      ...staticFiles,
      ...result.items.map((meta, index) => fileFromResource(meta, records[index] ?? null)),
    ],
    ...(result.nextCursor === undefined
      ? {}
      : { nextCursor: encodeNodePlaceCursor(result.nextCursor) }),
  }
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
        sourceContext(ctx, ref, "content"),
      )
      const record = await getResource(resource, sourceContext(ctx, ref, "metadata"))
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
    const record = await getResource(resource, sourceContext(ctx, ref, "content"))
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
        const record = await getResource(resource, sourceContext(ctx, ref, "metadata"))
        return record ? fileFromResource(record.meta, record) : null
      } catch (error) {
        // FileSystem.stat 以 null 表达目标不存在；旧 resource source 可能用 not-found 异常表达
        // 同一状态，适配边界在这里归一化，避免 Display 泄漏底层错误文案。
        if (error instanceof ResourceSourceError && error.code === "not-found") return null
        rethrowFileSystemError(error, ref)
      }
    },
    async statMany(refs, ctx, options = {}) {
      if (refs.length === 0) return []
      const concurrency = options.concurrency ?? 4
      if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 32) {
        throw new FileSystemError(
          "invalid-input",
          "Stat concurrency must be an integer between 1 and 32",
        )
      }

      const results = new Array<IdeallFile | null>(refs.length).fill(null)
      const resources: Array<{ ref: FileRef; resource: ResourceRef; index: number }> = []
      const scalarStats: Array<{ ref: FileRef; index: number }> = []

      refs.forEach((ref, index) => {
        const resource = resourceRefForFile(ref)
        // Engine 对 activeFile 的隐式 metadata 授权依赖逐项 target，不能扩大为批量授权。
        if (resource && ctx.actor !== "engine") resources.push({ ref, resource, index })
        else scalarStats.push({ ref, index })
      })

      if (resources.length > 0) {
        try {
          const records = await getResources(
            resources.map((item) => item.resource),
            sourceContext(ctx, null, "metadata"),
            concurrency,
          )
          resources.forEach((item, index) => {
            const record = records[index]
            results[item.index] = record ? fileFromResource(record.meta, record) : null
          })
        } catch (error) {
          rethrowFileSystemError(error, resources[0]?.ref ?? refs[0]!)
        }
      }

      // root/place/panel 等虚拟文件很少；Engine ref 也在此保留原有逐项授权语义。
      for (const item of scalarStats) results[item.index] = await this.stat(item.ref, ctx)
      return results
    },
    async readDirectory(ref, ctx, options = {}) {
      let files: IdeallFile[]
      if (sameFileRef(ref, descriptor.root)) {
        files = CORE_PLACE_IDS.map(placeFile)
      } else {
        const place = placeForFile(ref)
        if (place) {
          const paged = await listPagedNodePlace(place, ref, ctx, options)
          if (paged) {
            return {
              entries: paged.files.map((file, index) => entry(ref, file, index)),
              nextCursor: paged.nextCursor,
            }
          }
          files = await listPlaceFiles(place, ctx, options.recursive === true)
        } else {
          const resource = resourceRefForFile(ref)
          if (!resource) {
            throw new FileSystemError("not-found", `Directory not found: ${fileRefKey(ref)}`, ref)
          }
          const page = await listResourceChildren(resource, ctx, options)
          return {
            entries: page.files.map((file, index) => entry(ref, file, index)),
            nextCursor: page.nextCursor,
          }
        }
      }
      const result = paginateDirectoryItems(ref, files, options)
      return {
        entries: result.items.map((file, index) => {
          const projectedParent =
            options.recursive === true && isFileRef(file.properties?.parentRef)
              ? file.properties.parentRef
              : ref
          const next = entry(projectedParent, file, result.offset + index)
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
            sourceContext(ctx, null, "content"),
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
        const write = async () => {
          const current = await getResource(resource, sourceContext(ctx, ref, "metadata"))
          if (!current) {
            throw new FileSystemError("not-found", `File not found: ${fileRefKey(ref)}`, ref)
          }
          const currentVersion = versionForResource(current.meta)
          assertExpectedVersion(ref, input.expectedVersion, currentVersion)
          const mutationContext = sourceContext(ctx, ref, "write", currentVersion ?? null)
          if (resource.scheme === "node" && resource.kind === "file") {
            if (typeof input.data !== "string") {
              throw new FileSystemError(
                "unsupported",
                "Node file adapter currently supports text writes only",
                ref,
              )
            }
            const result = await invokeResourceAction(
              resource,
              "write-blob",
              { content: input.data, mime: input.mediaType },
              mutationContext,
            )
            const record = committedResourceRecord(resource, result, "write-blob")
            return fileFromResource(record.meta, record)
          }
          const result = await invokeResourceAction(
            resource,
            "edit",
            typeof input.data === "object" && input.data !== null
              ? input.data
              : { content: input.data },
            mutationContext,
          )
          const record = committedResourceRecord(resource, result, "edit")
          return fileFromResource(record.meta, record)
        }
        return await (isNodeThreadResource(resource)
          ? withThreadMutationWriteLocks(ref, write)
          : withFileWriteLock(ref, write))
      } catch (error) {
        rethrowFileSystemError(error, ref)
      }
    },
    async actions(ref, ctx): Promise<FileAction[]> {
      const resource = resourceRefForFile(ref)
      assertCanListActions(ref, ctx)
      if (!resource) {
        const place = placeForFile(ref)
        if (
          place === "home" ||
          place === "subscriptions" ||
          place === "notes" ||
          place === "bookmarks" ||
          place === "files"
        ) {
          const actions: FileAction[] = [
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
          if (place === "bookmarks") {
            actions.push({
              id: CAPTURE_BOOKMARK_ACTION,
              label: "保存到我的",
              requires: ["create"],
              risk: "safe",
              idempotent: true,
              kind: "specialized",
              reason: "由内容界面提供链接、标题和摘要",
            })
          }
          return actions
        }
        return [{ id: "open", label: "打开", kind: "display" }]
      }
      try {
        const actions = await resourceActions(resource, sourceContext(ctx, ref, "action"))
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
    async invoke(ref, action, input, ctx, options) {
      const panel = panelForFile(ref)
      if (panel && action === "open") {
        assertCanInvoke(ref, action, ctx)
        return { panel }
      }
      const place = placeForFile(ref)
      if (place === "bookmarks" && action === CAPTURE_BOOKMARK_ACTION) {
        assertCanInvoke(ref, action, ctx)
        try {
          return await captureBookmarkStore(captureBookmarkInput(input))
        } catch (error) {
          rethrowFileSystemError(error, ref)
        }
      }
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
            sourceContext(ctx, ref, "action"),
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
        const invoke = async () => {
          if (
            action === "create" &&
            resource.scheme === "node" &&
            (resource.kind === "note" || resource.kind === "folder")
          ) {
            const created = (await invokeResourceAction(
              resource,
              "create",
              input,
              sourceContext(ctx, ref, "action", options?.expectedVersion),
            )) as ResourceRecord
            const file = fileFromResource(created.meta, created)
            return { ref: file.ref, file }
          }
          return invokeResourceAction(
            resource,
            action as never,
            input,
            sourceContext(ctx, ref, "action", options?.expectedVersion),
          )
        }
        return await (isNodeThreadResource(resource) && action !== "open"
          ? withThreadMutationWriteLocks(ref, invoke)
          : invoke())
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
            sourceContext(ctx, ref, "watch"),
            (change) => {
              const changedRef = change?.ref ? resourceFileRef(change.ref) : null
              const event: FileSystemWatchEvent =
                place && changedRef
                  ? {
                      type: "changed",
                      ref,
                      changes: [{ type: "changed", ref: changedRef }],
                    }
                  : { type: "changed", ref: changedRef ?? ref }
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
