import type { ResourceCapability, ResourceRef, ResourceScheme } from "@protocol/resource"

export type ConnectedResourceScheme = Exclude<ResourceScheme, "node">
export type ConnectedResourceRef = Exclude<ResourceRef, { scheme: "node" }>

export type ConnectedStaticResource = {
  ref: ConnectedResourceRef
  title: string
}

export const CONNECTED_STATIC_RESOURCES: Record<
  ConnectedResourceScheme,
  ConnectedStaticResource[]
> = {
  info: [
    { ref: { scheme: "info", kind: "home", id: "default" }, title: "资讯" },
    { ref: { scheme: "info", kind: "search", id: "default" }, title: "资讯搜索" },
  ],
  community: [{ ref: { scheme: "community", kind: "home", id: "default" }, title: "社区" }],
  tool: [
    { ref: { scheme: "tool", kind: "search", id: "default" }, title: "搜索" },
    { ref: { scheme: "tool", kind: "ai", id: "default" }, title: "AI 网站" },
    { ref: { scheme: "tool", kind: "navigation", id: "default" }, title: "导航" },
  ],
  browser: [{ ref: { scheme: "browser", kind: "page", id: "default" }, title: "浏览器" }],
  app: [{ ref: { scheme: "app", kind: "native-app", id: "apps" }, title: "应用" }],
}

function routeQuery(path: string, params: Record<string, string | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value)
  }
  const query = search.toString()
  return query ? `${path}?${query}` : path
}

export function splitConnectedResourcePair(id: string): [string, string] | null {
  const colon = id.indexOf(":")
  const slash = id.indexOf("/")
  const split = colon > 0 ? colon : slash
  if (split <= 0 || split === id.length - 1) return null
  return [id.slice(0, split), id.slice(split + 1)]
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
        const pair = splitConnectedResourcePair(ref.id)
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

export function connectedResourceTitle(ref: ResourceRef): string {
  switch (ref.scheme) {
    case "node":
      return ref.id
    case "info":
      if (ref.kind === "home") return "资讯"
      if (ref.kind === "search") return ref.id === "default" ? "资讯搜索" : `搜索 · ${ref.id}`
      if (ref.kind === "publisher") return `发布者 · ${ref.id}`
      if (ref.kind === "entity")
        return `实体 · ${splitConnectedResourcePair(ref.id)?.[1] ?? ref.id}`
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

export function canSaveConnectedResourceToMine(ref: ResourceRef): boolean {
  if (ref.scheme === "node" || ref.id === "default") return false
  if (ref.scheme === "info") {
    if (ref.kind === "entity") return splitConnectedResourcePair(ref.id) != null
    return ref.kind === "publisher" || ref.kind === "search"
  }
  if (ref.scheme === "community") return ref.kind === "peer"
  if (ref.scheme === "browser") return ref.kind === "page"
  if (ref.scheme === "tool") {
    return ref.kind === "search" || ref.kind === "ai" || ref.kind === "navigation"
  }
  return false
}

export function connectedResourceCapabilities(ref: ResourceRef): ResourceCapability[] {
  const capabilities: ResourceCapability[] = ["open", "preview", "navigate"]
  if (canSaveConnectedResourceToMine(ref)) capabilities.push("save-to-mine")
  return capabilities
}
