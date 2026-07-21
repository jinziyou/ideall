import {
  DIRECTORY_MEDIA_TYPE,
  sameFileRef,
  type DirectoryEntry,
  type FileRef,
  type IdeallFile,
} from "@protocol/file-system"
import {
  type EntityDetail,
  type Info,
  type InfoQuery,
  type PeerPublisher,
  type Publication,
  type PublishDraft,
  type RelatedInfo,
} from "@protocol/server-port"
import type { ApiResult } from "@protocol/api-result"
import { getServerPort } from "@/lib/server/port-registry"
import type {
  DirectoryPage,
  FileAction,
  FileReadResult,
  FileSystemAccessContext,
  FileSystemProvider,
  FileWriteInput,
  ReadDirectoryOptions,
} from "./types"
import { FileSystemError } from "./types"

export const REMOTE_SERVER_FILE_SYSTEM_ID = "remote.server"

export const remoteServerRootRef: FileRef = {
  fileSystemId: REMOTE_SERVER_FILE_SYSTEM_ID,
  fileId: "root",
}

export const remoteInfoDirectoryRef: FileRef = {
  fileSystemId: REMOTE_SERVER_FILE_SYSTEM_ID,
  fileId: "directory:info",
}

export const remoteCommunityDirectoryRef: FileRef = {
  fileSystemId: REMOTE_SERVER_FILE_SYSTEM_ID,
  fileId: "directory:community",
}

type RemoteReadOperation =
  | { type: "info-query"; query: InfoQuery }
  | { type: "info"; url: string }
  | { type: "related-info"; url: string }
  | { type: "entity"; label: string; name: string }
  | { type: "peers" }
  | { type: "peer-publications"; peerId: string }

function operationRef(operation: RemoteReadOperation): FileRef {
  const normalized =
    operation.type === "info-query"
      ? {
          type: operation.type,
          query: {
            ...(operation.query.entity_label_name !== undefined
              ? { entity_label_name: operation.query.entity_label_name }
              : {}),
            ...(operation.query.publisher_domain !== undefined
              ? { publisher_domain: operation.query.publisher_domain }
              : {}),
            ...(operation.query.timestamp_from_to !== undefined
              ? { timestamp_from_to: operation.query.timestamp_from_to }
              : {}),
            ...(operation.query.page_size_offset !== undefined
              ? { page_size_offset: operation.query.page_size_offset }
              : {}),
          },
        }
      : operation
  return {
    fileSystemId: REMOTE_SERVER_FILE_SYSTEM_ID,
    fileId: `operation:${encodeURIComponent(JSON.stringify(normalized))}`,
  }
}

function parseOperation(ref: FileRef): RemoteReadOperation | null {
  if (ref.fileSystemId !== REMOTE_SERVER_FILE_SYSTEM_ID || !ref.fileId.startsWith("operation:")) {
    return null
  }
  try {
    const value = JSON.parse(decodeURIComponent(ref.fileId.slice("operation:".length))) as unknown
    if (!value || typeof value !== "object" || !("type" in value)) return null
    const operation = value as Partial<RemoteReadOperation> & Record<string, unknown>
    switch (operation.type) {
      case "info-query":
        return operation.query && typeof operation.query === "object"
          ? { type: operation.type, query: operation.query as InfoQuery }
          : null
      case "info":
      case "related-info":
        return typeof operation.url === "string" && operation.url
          ? { type: operation.type, url: operation.url }
          : null
      case "entity":
        return typeof operation.label === "string" && typeof operation.name === "string"
          ? { type: operation.type, label: operation.label, name: operation.name }
          : null
      case "peers":
        return { type: operation.type }
      case "peer-publications":
        return typeof operation.peerId === "string" && operation.peerId
          ? { type: operation.type, peerId: operation.peerId }
          : null
      default:
        return null
    }
  } catch {
    return null
  }
}

export function remoteInfoQueryRef(query: InfoQuery): FileRef {
  return operationRef({ type: "info-query", query })
}

export function remoteInfoRef(url: string): FileRef {
  return operationRef({ type: "info", url })
}

export function remoteRelatedInfoRef(url: string): FileRef {
  return operationRef({ type: "related-info", url })
}

export function remoteEntityRef(label: string, name: string): FileRef {
  return operationRef({ type: "entity", label, name })
}

export function remotePeersRef(): FileRef {
  return operationRef({ type: "peers" })
}

export function remotePeerPublicationsRef(peerId: string): FileRef {
  return operationRef({ type: "peer-publications", peerId })
}

function directoryFile(
  ref: FileRef,
  name: string,
  section: "root" | "info" | "community",
): IdeallFile {
  return {
    ref,
    kind: "directory",
    name,
    mediaType: DIRECTORY_MEDIA_TYPE,
    capabilities: ["read-directory", "actions"],
    source: { kind: "remote", id: "server", label: "远程服务", readOnly: true },
    properties: { section },
  }
}

function operationName(operation: RemoteReadOperation): string {
  switch (operation.type) {
    case "info-query":
      return "资讯查询"
    case "info":
      return operation.url
    case "related-info":
      return `全面报道 · ${operation.url}`
    case "entity":
      return `实体 · ${operation.name}`
    case "peers":
      return "社区发布者"
    case "peer-publications":
      return `发布 · ${operation.peerId}`
  }
}

function operationMediaType(operation: RemoteReadOperation): string {
  return operation.type === "peers" || operation.type === "peer-publications"
    ? "application/vnd.ideall.remote.community+json"
    : "application/vnd.ideall.remote.info+json"
}

function operationFile(operation: RemoteReadOperation): IdeallFile {
  return {
    ref: operationRef(operation),
    kind: "file",
    name: operationName(operation),
    mediaType: operationMediaType(operation),
    capabilities: ["read", "actions"],
    source: { kind: "remote", id: "server", label: "远程服务", readOnly: true },
    properties: { remoteOperation: operation.type },
  }
}

function assertAccess(
  ctx: FileSystemAccessContext,
  ref: FileRef,
  intent: NonNullable<FileSystemAccessContext["intent"]>,
  permission: "remote:read" | "remote:write",
  allowActiveEngine = true,
): void {
  if (ctx.actor === "ui" || ctx.actor === "system") return
  if (
    allowActiveEngine &&
    ctx.actor === "engine" &&
    ctx.activeFile != null &&
    sameFileRef(ctx.activeFile, ref) &&
    ctx.intent === intent
  ) {
    return
  }
  if (ctx.intent === intent && ctx.permissions.includes(permission)) return
  throw new FileSystemError(
    "permission-denied",
    `${ctx.actor} 访问远程文件需要 ${permission} 权限与 ${intent} intent`,
    ref,
  )
}

function parseOffset(cursor: string | undefined): number {
  if (cursor === undefined) return 0
  if (!/^(0|[1-9]\d*)$/.test(cursor)) {
    throw new FileSystemError("invalid-input", `Invalid remote directory cursor: ${cursor}`)
  }
  return Number(cursor)
}

function pageSize(limit: number | undefined): number {
  if (limit === undefined) return 50
  if (!Number.isInteger(limit) || limit <= 0 || limit > 200) {
    throw new FileSystemError("invalid-input", "Remote directory limit must be between 1 and 200")
  }
  return limit
}

function directoryEntry(parent: FileRef, target: FileRef, name: string): DirectoryEntry {
  return {
    entryId: target.fileId,
    parent,
    target,
    name,
    kind: "child",
  }
}

async function readRemoteOperation(operation: RemoteReadOperation): Promise<FileReadResult> {
  const server = getServerPort()
  let data: unknown
  switch (operation.type) {
    case "info-query":
      data = await server.queryInfo(operation.query)
      break
    case "info":
      data = await server.getInfo(operation.url)
      break
    case "related-info":
      data = await server.getRelatedInfo(operation.url)
      break
    case "entity":
      data = await server.getEntityDetail(operation.label, operation.name)
      break
    case "peers":
      data = await server.listPeers()
      break
    case "peer-publications":
      data = await server.getPeerPublications(operation.peerId)
      break
  }
  return { data, mediaType: operationMediaType(operation) }
}

export const remoteServerFileSystem: FileSystemProvider = {
  descriptor: {
    fileSystemId: REMOTE_SERVER_FILE_SYSTEM_ID,
    name: "远程内容",
    root: remoteServerRootRef,
    source: { kind: "remote", id: "server", label: "远程服务", readOnly: true },
    capabilities: ["read-directory", "read", "actions"],
  },
  async stat(ref, ctx) {
    assertAccess(ctx, ref, "metadata", "remote:read")
    if (sameFileRef(ref, remoteServerRootRef)) {
      return directoryFile(ref, "远程内容", "root")
    }
    if (sameFileRef(ref, remoteInfoDirectoryRef)) {
      return directoryFile(ref, "远程资讯", "info")
    }
    if (sameFileRef(ref, remoteCommunityDirectoryRef)) {
      return directoryFile(ref, "远程社区", "community")
    }
    const operation = parseOperation(ref)
    return operation ? operationFile(operation) : null
  },
  async readDirectory(ref, ctx, options: ReadDirectoryOptions = {}): Promise<DirectoryPage> {
    assertAccess(ctx, ref, "directory", "remote:read")
    if (sameFileRef(ref, remoteServerRootRef)) {
      return {
        entries: [
          directoryEntry(remoteServerRootRef, remoteInfoDirectoryRef, "远程资讯"),
          directoryEntry(remoteServerRootRef, remoteCommunityDirectoryRef, "远程社区"),
        ],
      }
    }

    const offset = parseOffset(options.cursor)
    const limit = pageSize(options.limit)
    if (sameFileRef(ref, remoteInfoDirectoryRef)) {
      const result = await getServerPort().queryInfo({ page_size_offset: [limit, offset] })
      if (!result.ok) throw new FileSystemError("offline", result.message, ref)
      const rows = result.data ?? []
      return {
        entries: rows.map((info) =>
          directoryEntry(remoteInfoDirectoryRef, remoteInfoRef(info.url), info.title || info.url),
        ),
        nextCursor: rows.length === limit ? String(offset + rows.length) : undefined,
      }
    }
    if (sameFileRef(ref, remoteCommunityDirectoryRef)) {
      const result = await getServerPort().listPeers()
      if (!result.ok) throw new FileSystemError("offline", result.message, ref)
      const peers = (result.data ?? []).slice(offset, offset + limit)
      return {
        entries: peers.map((peer) =>
          directoryEntry(
            remoteCommunityDirectoryRef,
            remotePeerPublicationsRef(String(peer.id)),
            peer.name,
          ),
        ),
        nextCursor:
          offset + peers.length < (result.data?.length ?? 0)
            ? String(offset + peers.length)
            : undefined,
      }
    }
    throw new FileSystemError("unsupported", "Remote file is not a directory", ref)
  },
  async read(ref, ctx, options): Promise<FileReadResult> {
    assertAccess(ctx, ref, "content", "remote:read")
    if (options?.range) {
      throw new FileSystemError(
        "unsupported",
        "Remote structured content does not support byte ranges",
        ref,
      )
    }
    const operation = parseOperation(ref)
    if (!operation) throw new FileSystemError("not-found", "Remote file not found", ref)
    return readRemoteOperation(operation)
  },
  async write(ref, _input: FileWriteInput, ctx): Promise<IdeallFile> {
    assertAccess(ctx, ref, "write", "remote:write", false)
    throw new FileSystemError("unsupported", "Remote content uses explicit actions", ref)
  },
  async actions(ref, ctx): Promise<FileAction[]> {
    assertAccess(ctx, ref, "action", "remote:read")
    if (sameFileRef(ref, remoteCommunityDirectoryRef)) {
      return [
        {
          id: "publish",
          label: "发布",
          requires: ["remote:write"],
          kind: "specialized",
          reason: "需在发布界面完成鉴权与内容确认",
        },
        {
          id: "delete-publication",
          label: "删除发布",
          risk: "destructive",
          requires: ["remote:write"],
          kind: "specialized",
          reason: "需在发布管理界面确认身份",
        },
      ]
    }
    const operation = parseOperation(ref)
    if (!operation) return []
    return [{ id: "open", label: "打开", requires: ["read"], kind: "display" }]
  },
  async invoke(ref, action, input, ctx): Promise<unknown> {
    if (action === "open") {
      assertAccess(ctx, ref, "action", "remote:read")
      return { ref }
    }
    assertAccess(ctx, ref, "action", "remote:write", false)
    if (action === "publish" && sameFileRef(ref, remoteCommunityDirectoryRef)) {
      const value = input as { token?: unknown; draft?: unknown }
      if (typeof value?.token !== "string" || !value.token || !value.draft) {
        throw new FileSystemError("invalid-input", "Publish requires token and draft", ref)
      }
      return getServerPort().publish(value.token, value.draft as PublishDraft)
    }
    if (action === "delete-publication" && sameFileRef(ref, remoteCommunityDirectoryRef)) {
      const value = input as { token?: unknown; id?: unknown }
      if (
        typeof value?.token !== "string" ||
        !value.token ||
        typeof value.id !== "string" ||
        !value.id
      ) {
        throw new FileSystemError("invalid-input", "Delete requires token and publication id", ref)
      }
      return getServerPort().deletePublication(value.token, value.id)
    }
    throw new FileSystemError("unsupported", `Unsupported remote action: ${action}`, ref)
  },
}

const SYSTEM_READ_CONTEXT: FileSystemAccessContext = {
  actor: "system",
  permissions: [],
  intent: "content",
}

/** 同构 facade 使用同一 provider；SSR 不依赖客户端 registry 的启动时机。 */
export async function readRemoteServerFile<T>(ref: FileRef): Promise<T> {
  const result = await remoteServerFileSystem.read(ref, SYSTEM_READ_CONTEXT, { encoding: "json" })
  return result.data as T
}

export async function invokeRemoteServerAction<T>(
  action: "publish" | "delete-publication",
  input: unknown,
): Promise<T> {
  return (await remoteServerFileSystem.invoke(remoteCommunityDirectoryRef, action, input, {
    actor: "system",
    permissions: [],
    intent: "action",
  })) as T
}

export type RemoteInfoQueryResult = ApiResult<Info[]>
export type RemoteInfoResult = ApiResult<Info>
export type RemoteRelatedInfoResult = RelatedInfo[]
export type RemoteEntityResult = EntityDetail | null
export type RemotePeersResult = ApiResult<PeerPublisher[]>
export type RemotePeerPublicationsResult = ApiResult<Publication[]>
