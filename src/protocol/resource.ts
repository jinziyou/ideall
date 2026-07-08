import { isNodeKind, NODE_KINDS, type NodeKind } from "./node"

export const RESOURCE_KINDS = {
  node: NODE_KINDS,
  info: ["home", "entity", "publisher", "search"],
  community: ["home", "peer", "publication"],
  tool: ["search", "ai", "navigation"],
  browser: ["page", "bookmark"],
  app: ["native-app"],
} as const

export type ResourceScheme = keyof typeof RESOURCE_KINDS

export type InfoResourceKind = (typeof RESOURCE_KINDS.info)[number]
export type CommunityResourceKind = (typeof RESOURCE_KINDS.community)[number]
export type ToolResourceKind = (typeof RESOURCE_KINDS.tool)[number]
export type BrowserResourceKind = (typeof RESOURCE_KINDS.browser)[number]
export type AppResourceKind = (typeof RESOURCE_KINDS.app)[number]

export type NodeResourceRef = {
  scheme: "node"
  kind: NodeKind
  id: string
}

export type ResourceRef =
  | NodeResourceRef
  | { scheme: "info"; kind: InfoResourceKind; id: string }
  | { scheme: "community"; kind: CommunityResourceKind; id: string }
  | { scheme: "tool"; kind: ToolResourceKind; id: string }
  | { scheme: "browser"; kind: BrowserResourceKind; id: string }
  | { scheme: "app"; kind: AppResourceKind; id: string }

export type ResourceCapability =
  | "open"
  | "preview"
  | "edit"
  | "delete"
  | "restore"
  | "move"
  | "sync"
  | "read-content"
  | "read-blob"
  | "save-to-mine"
  | "navigate"

export type ResourceMeta = {
  ref: ResourceRef
  title: string
  subtitle?: string
  parent?: ResourceRef
  sortKey?: string
  hasChildren?: boolean
  updatedAt?: number
  iconHint?: string
  route?: string
  capabilities: ResourceCapability[]
}

export type ResourceRecord = {
  meta: ResourceMeta
  content?: unknown
}

export function isResourceScheme(value: string): value is ResourceScheme {
  return value in RESOURCE_KINDS
}

function hasKind<const T extends readonly string[]>(kinds: T, value: string): value is T[number] {
  return (kinds as readonly string[]).includes(value)
}

export function isResourceKindForScheme(
  scheme: ResourceScheme,
  kind: string,
): kind is ResourceRef["kind"] {
  if (scheme === "node") return isNodeKind(kind)
  return hasKind(RESOURCE_KINDS[scheme], kind)
}

export function resourceKey(ref: ResourceRef): string {
  return `${ref.scheme}:${ref.kind}:${encodeURIComponent(ref.id)}`
}

export function resourceQueryValue(ref: ResourceRef): string {
  return encodeURIComponent(resourceKey(ref))
}

export function parseResourceKey(raw: string | null | undefined): ResourceRef | null {
  if (!raw) return null
  const first = raw.indexOf(":")
  if (first <= 0) return null
  const second = raw.indexOf(":", first + 1)
  if (second <= first + 1) return null

  const scheme = raw.slice(0, first)
  const kind = raw.slice(first + 1, second)
  let id: string
  try {
    id = decodeURIComponent(raw.slice(second + 1))
  } catch {
    return null
  }
  if (!id || !isResourceScheme(scheme)) return null

  switch (scheme) {
    case "node":
      return isNodeKind(kind) ? { scheme, kind, id } : null
    case "info":
      return hasKind(RESOURCE_KINDS.info, kind) ? { scheme, kind, id } : null
    case "community":
      return hasKind(RESOURCE_KINDS.community, kind) ? { scheme, kind, id } : null
    case "tool":
      return hasKind(RESOURCE_KINDS.tool, kind) ? { scheme, kind, id } : null
    case "browser":
      return hasKind(RESOURCE_KINDS.browser, kind) ? { scheme, kind, id } : null
    case "app":
      return hasKind(RESOURCE_KINDS.app, kind) ? { scheme, kind, id } : null
  }
}

export function parseLegacyNodeResource(raw: string | null | undefined): NodeResourceRef | null {
  if (!raw) return null
  const i = raw.indexOf(":")
  if (i <= 0) return null
  const kind = raw.slice(0, i)
  let id: string
  try {
    id = decodeURIComponent(raw.slice(i + 1))
  } catch {
    return null
  }
  if (!isNodeKind(kind) || !id) return null
  return { scheme: "node", kind, id }
}

export function parseResourceSearch(search: string): ResourceRef | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
  const resource = parseResourceKey(params.get("resource"))
  if (resource) return resource
  return parseLegacyNodeResource(params.get("node"))
}
