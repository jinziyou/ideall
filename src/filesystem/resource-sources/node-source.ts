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
  getNodeForMutation,
  getNodeRaw,
  getNodesRaw,
  getThreadMetadataMany,
  listNodeSummaries,
  listNodeSummaryPage,
  moveNode,
  readBlob,
  readBlobBase64,
  restoreNodeWithResult,
  updateNode,
  ALL_NODE_KINDS,
  type NodeSummary,
  type NodeSummaryPage,
  type NodeSummaryPageOptions,
} from "@/files/stores/nodes-store"
import {
  NodeMutationConflictError,
  nodeMutationExpectation,
  type NodeMutationExpectation,
} from "@/files/stores/node-mutation"
import type { TrashMutationExpectation } from "@/files/stores/trash-store"
import { addFileWithNode, updateFileContent } from "@/files/stores/files-store"
import type {
  ResourceAction,
  ResourceActionId,
  ResourceQuery,
  ResourceRecord,
  ResourceSourceAccessContext,
  ResourceSourceProvider,
} from "./types"
import { ResourceSourceError } from "./types"
import { matchesResourceText, paginateResourceMeta } from "./query-utils"

export type NodeResourceSourceDeps = {
  listNodeSummaries: (kinds: NodeKind[]) => Promise<NodeSummary[]>
  listNodeSummaryPage?: (
    kinds: NodeKind[],
    options: NodeSummaryPageOptions,
  ) => Promise<NodeSummaryPage>
  getNodeRaw: (id: string) => Promise<Node | undefined>
  /** mutation 专用 fresh read，包含 tombstone。 */
  getNodeForMutation: (id: string) => Promise<Node | undefined>
  getNodesRaw: (ids: readonly string[]) => Promise<Array<Node | undefined>>
  /** metadata intent 的 thread 快速路径；不得读取/克隆 messages。 */
  getThreadMetadataMany?: (ids: readonly string[]) => Promise<Array<Node | undefined>>
  createNode: (input: FsCreateInput) => Promise<Node>
  createFile: typeof addFileWithNode
  updateNode: (
    kind: NodeKind,
    id: string,
    patch: FsWritePatch,
    expected?: NodeMutationExpectation,
  ) => Promise<Node | undefined>
  moveNode: (
    kind: NodeKind,
    id: string,
    parentId: string | null,
    afterSortKey?: string | null,
    expected?: NodeMutationExpectation,
  ) => Promise<Node | undefined>
  deleteNode: (kind: NodeKind, id: string, expected?: NodeMutationExpectation) => Promise<boolean>
  restoreNodeWithResult: (
    kind: NodeKind,
    id: string,
    expected?: TrashMutationExpectation,
  ) => Promise<Node | undefined>
  readBlob: (id: string) => Promise<Blob | undefined>
  readBlobBase64: (
    id: string,
  ) => Promise<{ mime: string; size: number; base64: string } | undefined>
  updateFileContent: (
    id: string,
    content: string,
    mime?: string,
    expected?: NodeMutationExpectation,
  ) => Promise<Node | undefined>
}

const defaultDeps: NodeResourceSourceDeps = {
  listNodeSummaries,
  listNodeSummaryPage,
  getNodeRaw,
  getNodeForMutation,
  getNodesRaw,
  getThreadMetadataMany,
  createNode,
  createFile: addFileWithNode,
  updateNode,
  moveNode,
  deleteNode,
  restoreNodeWithResult,
  readBlob,
  readBlobBase64,
  updateFileContent,
}

const READ_PERMISSION = "fs:read"
const READ_NOTES_PERMISSION = "fs.notes:read"
const READ_BLOBS_PERMISSION = "fs.blobs:read"
const WRITE_PERMISSION = "fs:write"
const WRITE_NOTES_PERMISSION = "fs.notes:write"

function hasPermission(ctx: ResourceSourceAccessContext, permission: string): boolean {
  return ctx.permissions.includes(permission)
}

function canReadMetadata(ctx: ResourceSourceAccessContext): boolean {
  return ctx.actor === "ui" || hasPermission(ctx, READ_PERMISSION)
}

function assertCanReadMetadata(ctx: ResourceSourceAccessContext): void {
  if (!canReadMetadata(ctx)) {
    throw new ResourceSourceError("permission-denied", "Missing fs:read permission")
  }
}

function canReadPrivateContent(ref: NodeResourceRef, ctx: ResourceSourceAccessContext): boolean {
  return (
    ctx.actor === "ui" ||
    hasPermission(ctx, READ_NOTES_PERMISSION) ||
    (ctx.activeRef != null && resourceKey(ctx.activeRef) === resourceKey(ref))
  )
}

function canReadBlob(ctx: ResourceSourceAccessContext): boolean {
  return ctx.actor === "ui" || hasPermission(ctx, READ_BLOBS_PERMISSION)
}

function canWriteKind(kind: NodeKind, ctx: ResourceSourceAccessContext): boolean {
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
      throw new ResourceSourceError("unsupported", `Unsupported node kind: ${kind}`)
    }
    if (!kinds.includes(kind)) kinds.push(kind)
  }
  return kinds
}

function asNodeRef(ref: ResourceRef): NodeResourceRef {
  if (ref.scheme !== "node" || !isNodeKind(ref.kind)) {
    throw new ResourceSourceError("unsupported", `Unsupported node resource: ${resourceKey(ref)}`)
  }
  return ref
}

function capabilitiesForKind(kind: NodeKind): ResourceCapability[] {
  switch (kind) {
    case "folder":
      return ["open", "preview", "create", "edit", "delete", "move", "sync"]
    case "note":
      return ["open", "preview", "create", "edit", "delete", "move", "sync", "read-content"]
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

function pagedSummaryMeta(summary: NodeSummary): ResourceMeta {
  const meta = summaryMeta(summary, new Map())
  if (!summary.parentId) return meta
  const parentKind = summary.kind === "bookmark" ? "folder" : summary.kind
  return { ...meta, parent: nodeRef(parentKind, summary.parentId) }
}

function nodeMeta(node: Node): ResourceMeta {
  const ref = nodeRef(node.kind, node.id)
  const parent =
    node.parentId == null
      ? undefined
      : node.kind === "note"
        ? nodeRef("note", node.parentId)
        : node.kind === "bookmark"
          ? nodeRef("folder", node.parentId)
          : undefined
  return {
    ref,
    title: node.title || "Untitled",
    ...(parent ? { parent } : {}),
    sortKey: node.sortKey,
    updatedAt: node.updatedAt,
    iconHint: node.kind === "file" ? node.blobRef.mime : node.kind,
    capabilities: capabilitiesForKind(node.kind),
  }
}

function matchesSummaryParent(summary: NodeSummary, parent: ResourceQuery["parent"]): boolean {
  if (!parent) return true
  if (parent.scheme !== "node") return false
  return summary.parentId === parent.id
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

function createInput(input: unknown): FsCreateInput {
  const raw = objectInput(input)
  if (typeof raw.kind !== "string" || !isNodeKind(raw.kind)) {
    throw new ResourceSourceError("unsupported", "create requires a supported node kind")
  }
  if (
    raw.tags !== undefined &&
    (!Array.isArray(raw.tags) || !raw.tags.every((v) => typeof v === "string"))
  ) {
    throw new ResourceSourceError("unsupported", "create tags must be strings")
  }
  return {
    kind: raw.kind,
    ...(raw.parentId === null || typeof raw.parentId === "string"
      ? { parentId: raw.parentId }
      : {}),
    ...(typeof raw.title === "string" ? { title: raw.title } : {}),
    ...(Array.isArray(raw.tags) ? { tags: raw.tags as string[] } : {}),
    ...(raw.content !== undefined ? { content: raw.content } : {}),
  }
}

function blobWriteInput(input: unknown): { content: string; mime?: string } {
  const raw = objectInput(input)
  if (typeof raw.content !== "string") {
    throw new ResourceSourceError("unsupported", "write-blob requires string content")
  }
  return {
    content: raw.content,
    ...(typeof raw.mime === "string" && raw.mime ? { mime: raw.mime } : {}),
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

async function requireNode(deps: NodeResourceSourceDeps, ref: NodeResourceRef): Promise<Node> {
  const node = await deps.getNodeRaw(ref.id)
  if (!node || node.kind !== ref.kind || node.deletedAt != null) {
    throw new ResourceSourceError("not-found", `Node not found: ${resourceKey(ref)}`)
  }
  return node
}

function mutationExpectation(
  node: Node,
  expectedVersion: ResourceSourceAccessContext["expectedVersion"],
): NodeMutationExpectation {
  const expected = nodeMutationExpectation(node)
  if (expectedVersion !== undefined && expectedVersion !== String(expected.updatedAt)) {
    throw new ResourceSourceError(
      "conflict",
      `Node version changed (expected ${expectedVersion ?? "no version"}, current ${expected.updatedAt})`,
    )
  }
  return expected
}

async function runNodeMutation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof NodeMutationConflictError) {
      throw new ResourceSourceError("conflict", error.message)
    }
    throw error
  }
}

function readableNodeRecord(
  node: Node,
  ref: NodeResourceRef,
  ctx: ResourceSourceAccessContext,
): ResourceRecord {
  const meta = nodeMeta(node)
  // metadata 永远只返回净化后的 Node；即使 UI 拥有正文权限，stat/statMany 也不能把
  // note 内容或 thread messages 带入 metadata batch 的中间结果。
  if (ctx.intent === "metadata") return { meta, content: stripNode(node) }
  if (isPrivateKind(node.kind) && !canReadPrivateContent(ref, ctx)) {
    throw new ResourceSourceError(
      "consent-required",
      "Reading note/thread content requires consent",
    )
  }
  return { meta, content: node }
}

function nodeActions(kind: NodeKind): ResourceAction[] {
  const actions: ResourceAction[] = [
    { id: "open", label: "打开", requires: ["open"], invocation: "display" },
    { id: "preview", label: "预览", requires: ["preview"], invocation: "display" },
  ]
  if (kind === "note" || kind === "folder") {
    actions.push({
      id: "create",
      label: kind === "note" ? "新建子页" : "新增书签",
      requires: ["create"],
    })
  }
  if (kind !== "feed") actions.push({ id: "edit", label: "编辑", requires: ["edit"] })
  if (kind !== "feed" && kind !== "file" && kind !== "thread") {
    actions.push({ id: "move", label: "移动", requires: ["move"] })
  }
  if (kind === "file") {
    actions.push({ id: "read-blob", label: "读取文件", requires: ["read-blob"] })
    actions.push({ id: "write-blob", label: "写入文件", requires: ["edit"] })
  }
  if (kind === "bookmark" || kind === "feed") {
    actions.push({ id: "navigate", label: "访问", requires: ["navigate"] })
  }
  actions.push({
    id: "delete",
    label: "删除",
    risk: "destructive",
    requires: ["delete"],
  })
  return actions
}

export function createNodeResourceSource(
  deps: NodeResourceSourceDeps = defaultDeps,
): ResourceSourceProvider {
  return {
    scheme: "node",
    async list(query, ctx) {
      assertCanReadMetadata(ctx)
      const kinds = nodeKindsFromQuery(query)
      if (deps.listNodeSummaryPage && query.limit !== undefined && !query.text) {
        if (query.parent && query.rootOnly) {
          throw new ResourceSourceError(
            "unsupported",
            "Node query cannot combine parent and rootOnly",
          )
        }
        const parentId = query.rootOnly
          ? null
          : query.parent?.scheme === "node"
            ? query.parent.id
            : undefined
        const page = await deps.listNodeSummaryPage(kinds, {
          limit: query.limit,
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          ...(parentId === undefined ? {} : { parentId }),
        })
        return {
          items: page.items.map(pagedSummaryMeta),
          ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
        }
      }
      const summaries = await deps.listNodeSummaries(kinds)
      const byId = new Map(summaries.map((summary) => [summary.id, summary]))
      const metas = summaries
        .filter(
          (summary) =>
            matchesSummaryParent(summary, query.parent) &&
            (!query.rootOnly || summary.parentId === null),
        )
        .map((summary) => summaryMeta(summary, byId))
        .filter((meta) => matchesResourceText(meta, query.text))
        .sort((a, b) => {
          const bySortKey = (a.sortKey ?? "").localeCompare(b.sortKey ?? "")
          return bySortKey !== 0 ? bySortKey : a.title.localeCompare(b.title)
        })
      return paginateResourceMeta(metas, query.limit, query.cursor)
    },
    async create(input, ctx) {
      const raw = objectInput(input)
      if (raw.kind === "file") {
        if (!canWriteKind("file", ctx)) {
          throw new ResourceSourceError("permission-denied", "Missing write permission")
        }
        if (!(raw.file instanceof Blob) || typeof (raw.file as Partial<File>).name !== "string") {
          throw new ResourceSourceError("unsupported", "file creation requires a browser File")
        }
        if (
          raw.tags !== undefined &&
          (!Array.isArray(raw.tags) || !raw.tags.every((tag) => typeof tag === "string"))
        ) {
          throw new ResourceSourceError("unsupported", "file tags must be strings")
        }
        const node = await deps.createFile(
          raw.file as File,
          (raw.tags as string[] | undefined) ?? [],
        )
        return { meta: nodeMeta(node), content: stripNode(node) }
      }
      const value = createInput(input)
      if (!canWriteKind(value.kind, ctx)) {
        throw new ResourceSourceError("permission-denied", "Missing write permission")
      }
      if (value.parentId) {
        const parent = await deps.getNodeRaw(value.parentId)
        const validParent =
          parent != null &&
          parent.deletedAt == null &&
          ((value.kind === "note" && parent.kind === "note") ||
            (value.kind === "bookmark" && parent.kind === "folder"))
        if (!validParent) throw new ResourceSourceError("not-found", "Create parent does not exist")
      }
      const node = await deps.createNode(value)
      return { meta: nodeMeta(node), content: node }
    },
    async get(ref, ctx): Promise<ResourceRecord | null> {
      const nodeRefValue = asNodeRef(ref)
      assertCanReadMetadata(ctx)
      const useThreadMetadata =
        ctx.intent === "metadata" &&
        nodeRefValue.kind === "thread" &&
        deps.getThreadMetadataMany != null
      const node = useThreadMetadata
        ? (await deps.getThreadMetadataMany!([nodeRefValue.id]))[0]
        : await requireNode(deps, nodeRefValue)
      if (!node) {
        throw new ResourceSourceError("not-found", `Node not found: ${resourceKey(nodeRefValue)}`)
      }
      if (node.kind !== nodeRefValue.kind || node.deletedAt != null) {
        throw new ResourceSourceError("not-found", `Node not found: ${resourceKey(nodeRefValue)}`)
      }
      return readableNodeRecord(node, nodeRefValue, ctx)
    },
    async getMany(refs, ctx): Promise<Array<ResourceRecord | null>> {
      assertCanReadMetadata(ctx)
      const nodeRefs = refs.map(asNodeRef)
      let nodes: Array<Node | undefined>
      if (ctx.intent === "metadata" && deps.getThreadMetadataMany) {
        nodes = new Array<Node | undefined>(nodeRefs.length)
        const threadIndexes: number[] = []
        const otherIndexes: number[] = []
        nodeRefs.forEach((ref, index) => {
          if (ref.kind === "thread") threadIndexes.push(index)
          else otherIndexes.push(index)
        })
        const [threadNodes, otherNodes] = await Promise.all([
          threadIndexes.length
            ? deps.getThreadMetadataMany(threadIndexes.map((index) => nodeRefs[index]!.id))
            : Promise.resolve([]),
          otherIndexes.length
            ? deps.getNodesRaw(otherIndexes.map((index) => nodeRefs[index]!.id))
            : Promise.resolve([]),
        ])
        threadIndexes.forEach((targetIndex, index) => {
          nodes[targetIndex] = threadNodes[index]
        })
        otherIndexes.forEach((targetIndex, index) => {
          nodes[targetIndex] = otherNodes[index]
        })
      } else {
        nodes = await deps.getNodesRaw(nodeRefs.map((ref) => ref.id))
      }
      if (nodes.length !== nodeRefs.length) {
        throw new ResourceSourceError(
          "unsupported",
          `Node storage returned ${nodes.length} batch results for ${nodeRefs.length} refs`,
        )
      }
      return nodeRefs.map((ref, index) => {
        const node = nodes[index]
        if (!node || node.kind !== ref.kind || node.deletedAt != null) return null
        return readableNodeRecord(node, ref, ctx)
      })
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
          throw new ResourceSourceError(
            "unsupported",
            `Action ${action} is handled by display layer`,
          )
        case "navigate": {
          assertCanReadMetadata(ctx)
          const node = await requireNode(deps, nodeRefValue)
          if (node.kind === "bookmark") return { ref: nodeRefValue, url: node.content.url }
          if (node.kind === "feed" && node.content.type === "tool") {
            return { ref: nodeRefValue, url: node.content.key }
          }
          throw new ResourceSourceError(
            "unsupported",
            `Action ${action} is not supported by ${node.kind}`,
          )
        }
        case "create": {
          if (nodeRefValue.kind !== "note" && nodeRefValue.kind !== "folder") {
            throw new ResourceSourceError("unsupported", "Node cannot contain created children")
          }
          await requireNode(deps, nodeRefValue)
          const createdKind = nodeRefValue.kind === "note" ? "note" : "bookmark"
          if (!canWriteKind(createdKind, ctx)) {
            throw new ResourceSourceError("permission-denied", "Missing write permission")
          }
          const value = createInput({
            ...objectInput(input),
            kind: createdKind,
            parentId: nodeRefValue.id,
          })
          const node = await deps.createNode(value)
          return { meta: nodeMeta(node), content: node }
        }
        case "read-blob": {
          if (nodeRefValue.kind !== "file") {
            throw new ResourceSourceError("unsupported", "read-blob only supports file nodes")
          }
          if (!canReadBlob(ctx)) {
            throw new ResourceSourceError(
              "consent-required",
              "Reading file blob requires fs.blobs:read",
            )
          }
          await requireNode(deps, nodeRefValue)
          const blob =
            ctx.actor === "ui"
              ? await deps.readBlob(nodeRefValue.id)
              : await deps.readBlobBase64(nodeRefValue.id)
          if (!blob)
            throw new ResourceSourceError(
              "not-found",
              `Blob not found: ${resourceKey(nodeRefValue)}`,
            )
          return blob
        }
        case "write-blob": {
          if (nodeRefValue.kind !== "file") {
            throw new ResourceSourceError("unsupported", "write-blob only supports file nodes")
          }
          if (!canWriteKind(nodeRefValue.kind, ctx)) {
            throw new ResourceSourceError("permission-denied", "Missing write permission")
          }
          const current = await requireNode(deps, nodeRefValue)
          const expected = mutationExpectation(current, ctx.expectedVersion)
          const inputValue = blobWriteInput(input)
          const updated = await runNodeMutation(() =>
            deps.updateFileContent(nodeRefValue.id, inputValue.content, inputValue.mime, expected),
          )
          if (!updated) {
            throw new ResourceSourceError(
              "conflict",
              `Node changed before blob write: ${resourceKey(nodeRefValue)}`,
            )
          }
          return { meta: nodeMeta(updated), content: stripNode(updated) }
        }
        case "edit": {
          if (nodeRefValue.kind === "feed") {
            throw new ResourceSourceError("unsupported", "Feed nodes are managed by follow actions")
          }
          if (!canWriteKind(nodeRefValue.kind, ctx)) {
            throw new ResourceSourceError("permission-denied", "Missing write permission")
          }
          const current = await requireNode(deps, nodeRefValue)
          const expected = mutationExpectation(current, ctx.expectedVersion)
          const updated = await runNodeMutation(() =>
            deps.updateNode(nodeRefValue.kind, nodeRefValue.id, writePatch(input), expected),
          )
          if (!updated)
            throw new ResourceSourceError(
              "conflict",
              `Node changed before edit: ${resourceKey(nodeRefValue)}`,
            )
          return { meta: nodeMeta(updated), content: updated }
        }
        case "move": {
          if (
            nodeRefValue.kind !== "note" &&
            nodeRefValue.kind !== "bookmark" &&
            nodeRefValue.kind !== "folder"
          ) {
            throw new ResourceSourceError(
              "unsupported",
              `Node kind cannot be moved: ${nodeRefValue.kind}`,
            )
          }
          if (!canWriteKind(nodeRefValue.kind, ctx)) {
            throw new ResourceSourceError("permission-denied", "Missing write permission")
          }
          const current = await requireNode(deps, nodeRefValue)
          const expected = mutationExpectation(current, ctx.expectedVersion)
          const move = moveInput(input)
          const updated = await runNodeMutation(() =>
            deps.moveNode(
              nodeRefValue.kind,
              nodeRefValue.id,
              move.parentId,
              move.afterSortKey,
              expected,
            ),
          )
          if (!updated)
            throw new ResourceSourceError(
              "conflict",
              `Node changed before move: ${resourceKey(nodeRefValue)}`,
            )
          return { meta: nodeMeta(updated), content: updated }
        }
        case "delete": {
          if (!canWriteKind(nodeRefValue.kind, ctx)) {
            throw new ResourceSourceError("permission-denied", "Missing write permission")
          }
          const current = await requireNode(deps, nodeRefValue)
          const expected = mutationExpectation(current, ctx.expectedVersion)
          const deleted = await runNodeMutation(() =>
            deps.deleteNode(nodeRefValue.kind, nodeRefValue.id, expected),
          )
          if (!deleted) {
            throw new ResourceSourceError(
              "conflict",
              `Node changed before delete: ${resourceKey(nodeRefValue)}`,
            )
          }
          return { ref: nodeRefValue, deleted: true }
        }
        case "restore": {
          if (!canWriteKind(nodeRefValue.kind, ctx)) {
            throw new ResourceSourceError("permission-denied", "Missing write permission")
          }
          const current = await deps.getNodeForMutation(nodeRefValue.id)
          if (!current || current.kind !== nodeRefValue.kind || current.deletedAt == null) {
            throw new ResourceSourceError(
              "not-found",
              `Deleted node not found: ${resourceKey(nodeRefValue)}`,
            )
          }
          const expectedNode = mutationExpectation(current, ctx.expectedVersion)
          const expected: TrashMutationExpectation = {
            kind: expectedNode.kind,
            updatedAt: expectedNode.updatedAt,
            deletedAt: current.deletedAt,
          }
          const restored = await runNodeMutation(() =>
            deps.restoreNodeWithResult(nodeRefValue.kind, nodeRefValue.id, expected),
          )
          if (!restored) {
            throw new ResourceSourceError(
              "conflict",
              `Deleted node changed before restore: ${resourceKey(nodeRefValue)}`,
            )
          }
          return { meta: nodeMeta(restored), content: restored }
        }
        case "save-to-mine":
          throw new ResourceSourceError(
            "unsupported",
            `Action ${action} is not supported by node provider`,
          )
      }
    },
    watch(query, ctx, notify) {
      assertCanReadMetadata(ctx)
      const kinds = nodeKindsFromQuery(query)
      const watchedId = query.id
      const dispose = onFilesUpdated((detail) => {
        // 缺少 kind/id 的旧事件只能保守刷新；结构化事件必须同时匹配 kind 与精确资源。
        if (!detail?.kind) {
          notify()
          return
        }
        if (!isNodeKind(detail.kind) || !kinds.includes(detail.kind)) return
        if (watchedId && detail.id && detail.id !== watchedId) return
        notify(detail.id ? { ref: nodeRef(detail.kind, detail.id) } : undefined)
      })
      return { dispose }
    },
  }
}

export const nodeResourceSource = createNodeResourceSource()
