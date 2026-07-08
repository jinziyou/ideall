import type {
  ResourceCapability,
  ResourceMeta,
  ResourceRecord,
  ResourceRef,
  ResourceScheme,
} from "@protocol/resource"
import { isResourceKindForScheme, resourceKey } from "@protocol/resource"
import type {
  ResourceAction,
  ResourceActionId,
  ResourcePage,
  ResourceQuery,
  VfsProvider,
} from "./types"
import { VfsError } from "./types"

type RouteScheme = Exclude<ResourceScheme, "node">

type ConnectedRecord = ResourceRecord & {
  meta: ResourceMeta & { route: string }
}

function routeQuery(path: string, params: Record<string, string | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value)
  }
  const query = search.toString()
  return query ? `${path}?${query}` : path
}

function splitPair(id: string): [string, string] | null {
  const i = id.indexOf(":")
  if (i <= 0 || i === id.length - 1) return null
  return [id.slice(0, i), id.slice(i + 1)]
}

export function routeForConnectedResource(ref: ResourceRef): string | null {
  switch (ref.scheme) {
    case "node":
      return null
    case "info":
      if (ref.kind === "home") return "/info"
      if (ref.kind === "search")
        return routeQuery("/info/search", { q: ref.id === "default" ? undefined : ref.id })
      if (ref.kind === "publisher") return routeQuery("/info/publisher", { domain: ref.id })
      if (ref.kind === "entity") {
        const pair = splitPair(ref.id)
        return pair
          ? routeQuery("/info/entity", { label: pair[0], name: pair[1] })
          : routeQuery("/info/search", { q: ref.id })
      }
      return null
    case "community":
      if (ref.kind === "home") return "/community"
      if (ref.kind === "peer") return routeQuery("/community", { openPeer: ref.id })
      if (ref.kind === "publication") return routeQuery("/community/publication", { id: ref.id })
      return null
    case "tool":
      if (ref.kind === "search") return "/tool/search"
      if (ref.kind === "ai") return "/tool/ai"
      if (ref.kind === "navigation") return "/tool/navigation"
      return null
    case "browser":
      return "/browser"
    case "app":
      return "/apps"
  }
}

function connectedTitle(ref: ResourceRef): string {
  switch (ref.scheme) {
    case "node":
      return ref.id
    case "info":
      if (ref.kind === "home") return "资讯"
      if (ref.kind === "search") return ref.id === "default" ? "资讯搜索" : `搜索 · ${ref.id}`
      if (ref.kind === "publisher") return `发布者 · ${ref.id}`
      if (ref.kind === "entity") return `实体 · ${splitPair(ref.id)?.[1] ?? ref.id}`
      return ref.id
    case "community":
      if (ref.kind === "home") return "社区"
      if (ref.kind === "peer") return `社区发布者 · ${ref.id}`
      if (ref.kind === "publication") return `发布 · ${ref.id}`
      return ref.id
    case "tool":
      if (ref.kind === "search") return "搜索"
      if (ref.kind === "ai") return "AI 网站"
      if (ref.kind === "navigation") return "导航"
      return ref.id
    case "browser":
      return ref.kind === "page" ? ref.id : `书签 · ${ref.id}`
    case "app":
      return `应用 · ${ref.id}`
  }
}

function connectedCapabilities(ref: ResourceRef): ResourceCapability[] {
  return ["open", "preview", "navigate"]
}

function connectedRecord(ref: ResourceRef, title = connectedTitle(ref)): ConnectedRecord | null {
  const route = routeForConnectedResource(ref)
  if (!route) return null
  return {
    meta: {
      ref,
      title,
      route,
      iconHint: ref.kind,
      capabilities: connectedCapabilities(ref),
    },
    content: { route },
  }
}

function knownRecord(ref: ResourceRef, title?: string): ConnectedRecord {
  const record = connectedRecord(ref, title)
  if (!record) throw new VfsError("unsupported", `Unsupported route resource: ${resourceKey(ref)}`)
  return record
}

const INFO_RECORDS = [
  knownRecord({ scheme: "info", kind: "home", id: "default" }, "资讯"),
  knownRecord({ scheme: "info", kind: "search", id: "default" }, "资讯搜索"),
]

const COMMUNITY_RECORDS = [
  knownRecord({ scheme: "community", kind: "home", id: "default" }, "社区"),
]

const TOOL_RECORDS = [
  knownRecord({ scheme: "tool", kind: "search", id: "default" }, "搜索"),
  knownRecord({ scheme: "tool", kind: "ai", id: "default" }, "AI 网站"),
  knownRecord({ scheme: "tool", kind: "navigation", id: "default" }, "导航"),
]

const BROWSER_RECORDS = [knownRecord({ scheme: "browser", kind: "page", id: "default" }, "浏览器")]

const APP_RECORDS = [knownRecord({ scheme: "app", kind: "native-app", id: "apps" }, "应用")]

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
  const ids: Array<Extract<ResourceActionId, ResourceCapability>> = ["open", "preview", "navigate"]
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

function createRouteProvider(scheme: RouteScheme, staticRecords: ConnectedRecord[]): VfsProvider {
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
      const items = staticRecords
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
    async invoke(ref, action) {
      const record = recordForRef(ref)
      if (!record) throw new VfsError("not-found", `Resource not found: ${resourceKey(ref)}`)
      if (action === "open" || action === "preview" || action === "navigate") {
        return { ref, route: record.meta.route }
      }
      throw new VfsError("unsupported", `Action ${action} is not supported by ${scheme} provider`)
    },
  }
}

export const infoVfsProvider = createRouteProvider("info", INFO_RECORDS)
export const communityVfsProvider = createRouteProvider("community", COMMUNITY_RECORDS)
export const toolVfsProvider = createRouteProvider("tool", TOOL_RECORDS)
export const browserVfsProvider = createRouteProvider("browser", BROWSER_RECORDS)
export const appVfsProvider = createRouteProvider("app", APP_RECORDS)

export const connectedVfsProviders: VfsProvider[] = [
  infoVfsProvider,
  communityVfsProvider,
  toolVfsProvider,
  browserVfsProvider,
  appVfsProvider,
]
