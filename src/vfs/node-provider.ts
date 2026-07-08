import type { Node, NodeKind, FsCreateInput, FsWritePatch } from "@protocol/node"
import { isNodeKind, stripNode } from "@protocol/node"
import type {
  NodeResourceRef,
  ResourceCapability,
  ResourceMeta,
  ResourceRef,
} from "@protocol/resource"
import { resourceKey } from "@protocol/resource"
import { onFilesUpdated } from "@protocol/flowback"
import {
  createNode,
  deleteNode,
  getNodeRaw,
  listNodeSummaries,
  moveNode,
  readBlobBase64,
  updateNode,
  ALL_NODE_KINDS,
  type NodeSummary,
} from "@/files/stores/nodes-store"
import type {
  ResourceAction,
  ResourceActionId,
  ResourcePage,
  ResourceQuery,
  ResourceRecord,
  VfsAccessContext,
  VfsProvider,
} from "./types"
import { VfsError } from "./types"

export type NodeVfsProviderDeps = {
  listNodeSummaries: (kinds: NodeKind[]) => Promise<NodeSummary[]>
  getNodeRaw: (id: string) => Promise<Node | undefined>
  createNode: (input: FsCreateInput) => Promise<Node>
  updateNode: (kind: NodeKind, id: string, patch: FsWritePatch) => Promise<Node | undefined>
  moveNode: (
    kind: NodeKind,
    id: string,
    parentId: string | null,
    afterSortKey?: string | null,
  ) => Promise<Node | undefined>
  deleteNode: (kind: NodeKind, id: string) => Promise<void>
  readBlobBase64: (
    id: string,
  ) => Promise<{ mime: string; size: number; base64: string } | undefined>
}

const defaultDeps: NodeVfsProviderDeps = {
  listNodeSummaries,
  getNodeRaw,
  createNode,
  updateNode,
  moveNode,
  deleteNode,
  readBlobBase64,
}

const READ_PERMISSION = "fs:read"
const READ_NOTES_PERMISSION = "fs.notes:read"
const READ_BLOBS_PERMISSION = "fs.blobs:read"
const WRITE_PERMISSION = "fs:write"
const WRITE_NOTES_PERMISSION = "fs.notes:write"

function hasPermission(ctx: VfsAccessContext, permission: string): boolean {
  return ctx.permissions.includes(permission)
}

function canReadMetadata(ctx: VfsAccessContext): boolean {
  return ctx.actor === "ui" || hasPermission(ctx, READ_PERMISSION)
}

function assertCanReadMetadata(ctx: VfsAccessContext): void {
  if (!canReadMetadata(ctx)) {
    throw new VfsError("permission-denied", "Missing fs:read permission")
  }
}

function canReadPrivateContent(ref: NodeResourceRef, ctx: VfsAccessContext): boolean {
  return (
    ctx.actor === "ui" ||
    hasPermission(ctx, READ_NOTES_PERMISSION) ||
    (ctx.activeRef != null && resourceKey(ctx.activeRef) === resourceKey(ref))
  )
}

function canReadBlob(ctx: VfsAccessContext): boolean {
  return ctx.actor === "ui" || hasPermission(ctx, READ_BLOBS_PERMISSION)
}

function canWriteKind(kind: NodeKind, ctx: VfsAccessContext): boolean {
  if (ctx.actor === "ui") return true
  return kind === "note"
    ? hasPermission(ctx, WRITE_NOTES_PERMISSION)
    : hasPermission(ctx, WRITE_PERMISSION)
}

function isPrivateKind(kind: NodeKind): kind is "note" | "thread" {
  return kind === "note" || kind === "thread"
}

function nodeRef(kind: NodeKind, id: string): NodeResourceRef {
  return { scheme: "node", kind, id }
}

function nodeKindsFromQuery(query: ResourceQuery): NodeKind[] {
  const rawKinds = query.kinds ?? (query.kind != null ? [query.kind] : ALL_NODE_KINDS)
  const kinds: NodeKind[] = []
  for (const kind of rawKinds) {
    if (!isNodeKind(kind)) {
      throw new VfsError("unsupported", `Unsupported node kind: ${kind}`)
    }
    if (!kinds.includes(kind)) kinds.push(kind)
  }
  return kinds
}

function asNodeRef(ref: ResourceRef): NodeResourceRef {
  if (ref.scheme !== "node" || !isNodeKind(ref.kind)) {
    throw new VfsError("unsupported", `Unsupported node resource: ${resourceKey(ref)}`)
  }
  return ref
}

function capabilitiesForKind(kind: NodeKind): ResourceCapability[] {
  switch (kind) {
    case "folder":
      return ["open", "preview", "edit", "delete", "move", "sync"]
    case "note":
      return ["open", "preview", "edit", "delete", "move", "sync", "read-content"]
    case "bookmark":
      return ["open", "preview", "edit", "delete", "move", "sync", "navigate"]
    case "file":
      return ["open", "preview", "edit", "delete", "sync", "read-blob"]
    case "feed":
      return ["open", "preview", "delete", "sync", "navigate"]
    case "thread":
      return ["open", "preview", "edit", "delete", "sync", "read-content"]
  }
}

function summaryMeta(summary: NodeSummary, byId: Map<string, NodeSummary>): ResourceMeta {
  const ref = nodeRef(summary.kind, summary.id)
  const parent = summary.parentId ? byId.get(summary.parentId) : undefined
  return {
    ref,
    title: summary.title || "Untitled",
    ...(parent ? { parent: nodeRef(parent.kind, parent.id) } : {}),
    sortKey: summary.sortKey,
    hasChildren: summary.hasChildren,
    iconHint: summary.mime || summary.kind,
    capabilities: capabilitiesForKind(summary.kind),
  }
}

function nodeMeta(node: Node): ResourceMeta {
  const ref = nodeRef(node.kind, node.id)
  return {
    ref,
    title: node.title || "Untitled",
    sortKey: node.sortKey,
    updatedAt: node.updatedAt,
    iconHint: node.kind === "file" ? node.blobRef.mime : node.kind,
    capabilities: capabilitiesForKind(node.kind),
  }
}

function matchesText(meta: ResourceMeta, text: string | undefined): boolean {
  if (!text) return true
  return meta.title.toLocaleLowerCase().includes(text.trim().toLocaleLowerCase())
}

function matchesSummaryParent(summary: NodeSummary, parent: ResourceQuery["parent"]): boolean {
  if (!parent) return true
  if (parent.scheme !== "node") return false
  return summary.parentId === parent.id
}

function paginate(
  items: ResourceMeta[],
  limit: number | undefined,
  cursor: string | undefined,
): ResourcePage {
  const parsedOffset = cursor == null ? 0 : Number.parseInt(cursor, 10)
  const offset = Number.isFinite(parsedOffset) && parsedOffset > 0 ? parsedOffset : 0
  const pageLimit = limit != null && limit > 0 ? Math.floor(limit) : items.length
  const pageItems = items.slice(offset, offset + pageLimit)
  const nextOffset = offset + pageLimit
  return {
    items: pageItems,
    nextCursor: nextOffset < items.length ? String(nextOffset) : undefined,
  }
}

function objectInput(input: unknown): Record<string, unknown> {
  return input != null && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {}
}

function writePatch(input: unknown): FsWritePatch {
  const raw = objectInput(input)
  return {
    ...(typeof raw.title === "string" ? { title: raw.title } : {}),
    ...(Array.isArray(raw.tags) && raw.tags.every((tag) => typeof tag === "string")
      ? { tags: raw.tags }
      : {}),
    ...("content" in raw ? { content: raw.content } : {}),
    ...(raw.parentId === null || typeof raw.parentId === "string"
      ? { parentId: raw.parentId }
      : {}),
  }
}

function moveInput(input: unknown): { parentId: string | null; afterSortKey?: string | null } {
  const raw = objectInput(input)
  const parentId = raw.parentId === null || typeof raw.parentId === "string" ? raw.parentId : null
  return {
    parentId,
    ...(raw.afterSortKey === null || typeof raw.afterSortKey === "string"
      ? { afterSortKey: raw.afterSortKey }
      : {}),
  }
}

async function requireNode(deps: NodeVfsProviderDeps, ref: NodeResourceRef): Promise<Node> {
  const node = await deps.getNodeRaw(ref.id)
  if (!node || node.kind !== ref.kind) {
    throw new VfsError("not-found", `Node not found: ${resourceKey(ref)}`)
  }
  return node
}

function nodeActions(kind: NodeKind): ResourceAction[] {
  const actions: ResourceAction[] = [
    { id: "open", label: "打开", requires: ["open"] },
    { id: "preview", label: "预览", requires: ["preview"] },
  ]
  if (kind !== "feed") actions.push({ id: "edit", label: "编辑", requires: ["edit"] })
  if (kind !== "feed" && kind !== "file" && kind !== "thread") {
    actions.push({ id: "move", label: "移动", requires: ["move"] })
  }
  if (kind === "file") actions.push({ id: "read-blob", label: "读取文件", requires: ["read-blob"] })
  if (kind === "bookmark" || kind === "feed") {
    actions.push({ id: "navigate", label: "访问", requires: ["navigate"] })
  }
  actions.push({ id: "delete", label: "删除", destructive: true, requires: ["delete"] })
  return actions
}

export function createNodeVfsProvider(deps: NodeVfsProviderDeps = defaultDeps): VfsProvider {
  return {
    scheme: "node",
    async list(query, ctx) {
      assertCanReadMetadata(ctx)
      const kinds = nodeKindsFromQuery(query)
      const summaries = await deps.listNodeSummaries(kinds)
      const byId = new Map(summaries.map((summary) => [summary.id, summary]))
      const metas = summaries
        .filter((summary) => matchesSummaryParent(summary, query.parent))
        .map((summary) => summaryMeta(summary, byId))
        .filter((meta) => matchesText(meta, query.text))
        .sort((a, b) => {
          const bySortKey = (a.sortKey ?? "").localeCompare(b.sortKey ?? "")
          return bySortKey !== 0 ? bySortKey : a.title.localeCompare(b.title)
        })
      return paginate(metas, query.limit, query.cursor)
    },
    async get(ref, ctx): Promise<ResourceRecord | null> {
      const nodeRefValue = asNodeRef(ref)
      assertCanReadMetadata(ctx)
      const node = await requireNode(deps, nodeRefValue)
      const meta = nodeMeta(node)
      if (isPrivateKind(node.kind) && !canReadPrivateContent(nodeRefValue, ctx)) {
        if (ctx.intent === "metadata") return { meta, content: stripNode(node) }
        throw new VfsError("consent-required", "Reading note/thread content requires consent")
      }
      return { meta, content: node }
    },
    async actions(ref, ctx) {
      const nodeRefValue = asNodeRef(ref)
      assertCanReadMetadata(ctx)
      await requireNode(deps, nodeRefValue)
      return nodeActions(nodeRefValue.kind)
    },
    async invoke(ref, action, input, ctx) {
      const nodeRefValue = asNodeRef(ref)
      switch (action) {
        case "open":
        case "preview":
          throw new VfsError("unsupported", `Action ${action} is handled by display layer`)
        case "navigate": {
          assertCanReadMetadata(ctx)
          const node = await requireNode(deps, nodeRefValue)
          if (node.kind === "bookmark") return { ref: nodeRefValue, url: node.content.url }
          if (node.kind === "feed" && node.content.type === "tool") {
            return { ref: nodeRefValue, url: node.content.key }
          }
          throw new VfsError("unsupported", `Action ${action} is not supported by ${node.kind}`)
        }
        case "read-blob": {
          if (nodeRefValue.kind !== "file") {
            throw new VfsError("unsupported", "read-blob only supports file nodes")
          }
          if (!canReadBlob(ctx)) {
            throw new VfsError("consent-required", "Reading file blob requires fs.blobs:read")
          }
          const blob = await deps.readBlobBase64(nodeRefValue.id)
          if (!blob) throw new VfsError("not-found", `Blob not found: ${resourceKey(nodeRefValue)}`)
          return blob
        }
        case "edit": {
          if (!canWriteKind(nodeRefValue.kind, ctx)) {
            throw new VfsError("permission-denied", "Missing write permission")
          }
          const updated = await deps.updateNode(
            nodeRefValue.kind,
            nodeRefValue.id,
            writePatch(input),
          )
          if (!updated)
            throw new VfsError("not-found", `Node not found: ${resourceKey(nodeRefValue)}`)
          return { meta: nodeMeta(updated), content: updated }
        }
        case "move": {
          if (!canWriteKind(nodeRefValue.kind, ctx)) {
            throw new VfsError("permission-denied", "Missing write permission")
          }
          const move = moveInput(input)
          const updated = await deps.moveNode(
            nodeRefValue.kind,
            nodeRefValue.id,
            move.parentId,
            move.afterSortKey,
          )
          if (!updated)
            throw new VfsError("not-found", `Node not found: ${resourceKey(nodeRefValue)}`)
          return { meta: nodeMeta(updated), content: updated }
        }
        case "delete":
          if (!canWriteKind(nodeRefValue.kind, ctx)) {
            throw new VfsError("permission-denied", "Missing write permission")
          }
          await deps.deleteNode(nodeRefValue.kind, nodeRefValue.id)
          return { ref: nodeRefValue, deleted: true }
        case "restore":
        case "save-to-mine":
          throw new VfsError("unsupported", `Action ${action} is not supported by node provider`)
      }
    },
    watch(query, ctx, notify) {
      assertCanReadMetadata(ctx)
      const kinds = nodeKindsFromQuery(query)
      const dispose = onFilesUpdated((detail) => {
        if (!detail?.kind || (isNodeKind(detail.kind) && kinds.includes(detail.kind))) notify()
      })
      return { dispose }
    },
  }
}

export const nodeVfsProvider = createNodeVfsProvider()
