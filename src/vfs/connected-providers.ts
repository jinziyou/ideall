import type {
  ResourceCapability,
  ResourceMeta,
  ResourceRecord,
  ResourceRef,
} from "@protocol/resource"
import { isResourceKindForScheme, resourceKey } from "@protocol/resource"
import type { Subscription, SubscriptionType } from "@protocol/subscription"
import { onFilesUpdated, type FilesUpdate } from "@protocol/flowback"
import type { Bookmark } from "@protocol/files"
import { listBookmarks } from "@/files/stores/bookmarks-store"
import { listSubscriptionsByTypes } from "@/files/stores/subscriptions-store"
import {
  CONNECTED_STATIC_RESOURCES,
  connectedResourceCapabilities,
  connectedResourceTitle,
  routeForConnectedResource,
  splitConnectedResourcePair,
  type ConnectedResourceScheme,
} from "./connected-resource-manifest"
import { saveResourceToMine, type SaveToMineResult } from "./save-to-mine-projector"
import type {
  ResourceAction,
  ResourceActionId,
  ResourcePage,
  ResourceQuery,
  VfsAccessContext,
  VfsProvider,
} from "./types"
import { VfsError } from "./types"

export { routeForConnectedResource } from "./connected-resource-manifest"

type RouteScheme = ConnectedResourceScheme

type ConnectedRecord = ResourceRecord & {
  meta: ResourceMeta & { route: string }
}

export type ConnectedVfsProviderDeps = {
  listSubscriptionsByTypes: (types: SubscriptionType[]) => Promise<Subscription[]>
  listBookmarks: () => Promise<Bookmark[]>
  saveResourceToMine: (
    ref: ResourceRef,
    input: unknown,
    ctx: VfsAccessContext,
  ) => Promise<SaveToMineResult>
}

const defaultDeps: ConnectedVfsProviderDeps = {
  listSubscriptionsByTypes,
  listBookmarks,
  saveResourceToMine,
}

function connectedRecord(
  ref: ResourceRef,
  title = connectedResourceTitle(ref),
): ConnectedRecord | null {
  const route = routeForConnectedResource(ref)
  if (!route) return null
  return {
    meta: {
      ref,
      title,
      route,
      iconHint: ref.kind,
      capabilities: connectedResourceCapabilities(ref),
    },
    content: { route },
  }
}

function entityResourceId(sub: Subscription): string {
  if (sub.entityLabel && sub.entityName) return `${sub.entityLabel}:${sub.entityName}`
  const pair = splitConnectedResourcePair(sub.key)
  return pair ? `${pair[0]}:${pair[1]}` : sub.key
}

function subscriptionRecord(sub: Subscription): ConnectedRecord | null {
  switch (sub.type) {
    case "entity":
      return connectedRecord(
        { scheme: "info", kind: "entity", id: entityResourceId(sub) },
        sub.title || sub.entityName || sub.key,
      )
    case "publisher":
      return connectedRecord(
        { scheme: "info", kind: "publisher", id: sub.key },
        sub.title || sub.key,
      )
    case "search":
      return connectedRecord(
        { scheme: "info", kind: "search", id: sub.searchKeyword || sub.key },
        sub.title || sub.searchKeyword || sub.key,
      )
    case "peer":
      return connectedRecord(
        { scheme: "community", kind: "peer", id: sub.key },
        sub.title || sub.key,
      )
    case "tool":
      return null
  }
}

function bookmarkRecord(bookmark: Bookmark): ConnectedRecord | null {
  return connectedRecord(
    { scheme: "browser", kind: "bookmark", id: bookmark.url },
    bookmark.title || bookmark.url,
  )
}

function knownRecord(ref: ResourceRef, title?: string): ConnectedRecord {
  const record = connectedRecord(ref, title)
  if (!record) throw new VfsError("unsupported", `Unsupported route resource: ${resourceKey(ref)}`)
  return record
}

function staticRecordsFor(scheme: RouteScheme): ConnectedRecord[] {
  return CONNECTED_STATIC_RESOURCES[scheme].map((resource) =>
    knownRecord(resource.ref, resource.title),
  )
}

const INFO_RECORDS = staticRecordsFor("info")
const COMMUNITY_RECORDS = staticRecordsFor("community")
const TOOL_RECORDS = staticRecordsFor("tool")
const BROWSER_RECORDS = staticRecordsFor("browser")
const APP_RECORDS = staticRecordsFor("app")

function actionLabel(id: ResourceActionId): string {
  switch (id) {
    case "open":
      return "打开"
    case "preview":
      return "预览"
    case "navigate":
      return "访问"
    case "save-to-mine":
      return "保存到我的"
    case "edit":
      return "编辑"
    case "delete":
      return "删除"
    case "restore":
      return "恢复"
    case "move":
      return "移动"
    case "read-blob":
      return "读取文件"
  }
}

function actionsFor(meta: ResourceMeta): ResourceAction[] {
  const ids: Array<Extract<ResourceActionId, ResourceCapability>> = [
    "open",
    "preview",
    "navigate",
    "save-to-mine",
  ]
  return ids
    .filter((id) => meta.capabilities.includes(id))
    .map((id) => ({ id, label: actionLabel(id), requires: [id] }))
}

function queryKinds(query: ResourceQuery, scheme: RouteScheme): string[] | null {
  const rawKinds = query.kinds ?? (query.kind != null ? [query.kind] : null)
  if (!rawKinds) return null
  for (const kind of rawKinds) {
    if (!isResourceKindForScheme(scheme, kind)) {
      throw new VfsError("unsupported", `Unsupported ${scheme} kind: ${kind}`)
    }
  }
  return [...new Set(rawKinds)]
}

function matchesText(meta: ResourceMeta, text: string | undefined): boolean {
  if (!text?.trim()) return true
  return meta.title.toLocaleLowerCase().includes(text.trim().toLocaleLowerCase())
}

function paginate(
  items: ResourceMeta[],
  limit: number | undefined,
  cursor: string | undefined,
): ResourcePage {
  const parsedOffset = cursor == null ? 0 : Number.parseInt(cursor, 10)
  const offset = Number.isFinite(parsedOffset) && parsedOffset > 0 ? parsedOffset : 0
  const pageLimit = limit != null && limit > 0 ? Math.floor(limit) : items.length
  const nextOffset = offset + pageLimit
  return {
    items: items.slice(offset, nextOffset),
    nextCursor: nextOffset < items.length ? String(nextOffset) : undefined,
  }
}

type DynamicRecordLoader = (query: ResourceQuery) => Promise<ConnectedRecord[]>

function uniqueRecords(records: ConnectedRecord[]): ConnectedRecord[] {
  const seen = new Set<string>()
  const unique: ConnectedRecord[] = []
  for (const record of records) {
    const key = resourceKey(record.meta.ref)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(record)
  }
  return unique
}

function createRouteProvider(
  scheme: RouteScheme,
  staticRecords: ConnectedRecord[],
  loadDynamicRecords?: DynamicRecordLoader,
  saveToMine?: ConnectedVfsProviderDeps["saveResourceToMine"],
): VfsProvider {
  const byKey = new Map(staticRecords.map((record) => [resourceKey(record.meta.ref), record]))
  const recordForRef = (ref: ResourceRef): ConnectedRecord | null => {
    if (ref.scheme !== scheme || !isResourceKindForScheme(scheme, ref.kind)) {
      throw new VfsError("unsupported", `Unsupported ${scheme} resource: ${resourceKey(ref)}`)
    }
    return byKey.get(resourceKey(ref)) ?? connectedRecord(ref)
  }
  return {
    scheme,
    async list(query) {
      const kinds = queryKinds(query, scheme)
      const records = uniqueRecords([
        ...staticRecords,
        ...((await loadDynamicRecords?.(query)) ?? []),
      ])
      const items = records
        .map((record) => record.meta)
        .filter((meta) => !kinds || kinds.includes(meta.ref.kind))
        .filter((meta) => matchesText(meta, query.text))
      return paginate(items, query.limit, query.cursor)
    },
    async get(ref) {
      return recordForRef(ref)
    },
    async actions(ref) {
      const record = recordForRef(ref)
      return record ? actionsFor(record.meta) : []
    },
    async invoke(ref, action, input, ctx) {
      const record = recordForRef(ref)
      if (!record) throw new VfsError("not-found", `Resource not found: ${resourceKey(ref)}`)
      if (action === "open" || action === "preview" || action === "navigate") {
        return { ref, route: record.meta.route }
      }
      if (action === "save-to-mine") {
        if (!record.meta.capabilities.includes("save-to-mine") || !saveToMine) {
          throw new VfsError(
            "unsupported",
            `Action ${action} is not supported by ${scheme} provider`,
          )
        }
        return saveToMine(ref, input, ctx)
      }
      throw new VfsError("unsupported", `Action ${action} is not supported by ${scheme} provider`)
    },
    watch(query, _ctx, notify) {
      queryKinds(query, scheme)
      if (scheme === "browser") {
        const kinds = query.kinds ?? (query.kind != null ? [query.kind] : ["bookmark"])
        if (!kinds.includes("bookmark")) return null
        const dispose = onFilesUpdated((detail) => {
          if (!detail?.kind || detail.kind === "bookmark") notify()
        })
        return { dispose }
      }
      const types = subscriptionTypesForWatch(scheme, query)
      if (types.length === 0) return null
      const dispose = onFilesUpdated((detail) => {
        if (matchesSubscriptionUpdate(detail, types)) notify()
      })
      return { dispose }
    },
  }
}

function subscriptionTypesForInfoQuery(query: ResourceQuery): SubscriptionType[] {
  const kinds =
    query.kinds ?? (query.kind != null ? [query.kind] : ["entity", "publisher", "search"])
  const types: SubscriptionType[] = []
  if (kinds.includes("entity")) types.push("entity")
  if (kinds.includes("publisher")) types.push("publisher")
  if (kinds.includes("search")) types.push("search")
  return types
}

function subscriptionTypesForWatch(scheme: RouteScheme, query: ResourceQuery): SubscriptionType[] {
  if (scheme === "info") return subscriptionTypesForInfoQuery(query)
  if (scheme === "community") {
    const kinds = query.kinds ?? (query.kind != null ? [query.kind] : ["peer"])
    return kinds.includes("peer") ? ["peer"] : []
  }
  return []
}

function matchesSubscriptionUpdate(detail: FilesUpdate | undefined, types: SubscriptionType[]) {
  if (!detail?.kind) return true
  if (detail.kind !== "feed") return false
  if (!detail.subType) return true
  return types.includes(detail.subType as SubscriptionType)
}

export function createConnectedVfsProviders(
  deps: Partial<ConnectedVfsProviderDeps> = {},
): VfsProvider[] {
  const resolvedDeps: ConnectedVfsProviderDeps = { ...defaultDeps, ...deps }
  const infoVfsProvider = createRouteProvider(
    "info",
    INFO_RECORDS,
    async (query) => {
      const types = subscriptionTypesForInfoQuery(query)
      if (types.length === 0) return []
      const subs = await resolvedDeps.listSubscriptionsByTypes(types)
      return subs.flatMap((sub) => {
        const record = subscriptionRecord(sub)
        return record && record.meta.ref.scheme === "info" ? [record] : []
      })
    },
    resolvedDeps.saveResourceToMine,
  )
  const communityVfsProvider = createRouteProvider(
    "community",
    COMMUNITY_RECORDS,
    async (query) => {
      const kinds = query.kinds ?? (query.kind != null ? [query.kind] : ["peer"])
      if (!kinds.includes("peer")) return []
      const subs = await resolvedDeps.listSubscriptionsByTypes(["peer"])
      return subs.flatMap((sub) => {
        const record = subscriptionRecord(sub)
        return record && record.meta.ref.scheme === "community" ? [record] : []
      })
    },
    resolvedDeps.saveResourceToMine,
  )
  return [
    infoVfsProvider,
    communityVfsProvider,
    createRouteProvider("tool", TOOL_RECORDS, undefined, resolvedDeps.saveResourceToMine),
    createRouteProvider(
      "browser",
      BROWSER_RECORDS,
      async (query) => {
        const kinds = query.kinds ?? (query.kind != null ? [query.kind] : ["bookmark"])
        if (!kinds.includes("bookmark")) return []
        const bookmarks = await resolvedDeps.listBookmarks()
        return bookmarks.flatMap((bookmark) => {
          const record = bookmarkRecord(bookmark)
          return record ? [record] : []
        })
      },
      resolvedDeps.saveResourceToMine,
    ),
    createRouteProvider("app", APP_RECORDS, undefined, resolvedDeps.saveResourceToMine),
  ]
}

const defaultConnectedProviders = createConnectedVfsProviders()

export const [
  infoVfsProvider,
  communityVfsProvider,
  toolVfsProvider,
  browserVfsProvider,
  appVfsProvider,
] = defaultConnectedProviders

export const connectedVfsProviders: VfsProvider[] = defaultConnectedProviders
