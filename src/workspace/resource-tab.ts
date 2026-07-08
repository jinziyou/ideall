import type { NodeResourceRef, ResourceMeta, ResourceRef } from "@protocol/resource"
import { parseResourceKey, resourceKey, resourceQueryValue } from "@protocol/resource"
import { isNodeKind } from "@protocol/node"
import {
  connectedResourceTitle,
  routeForConnectedResource,
} from "@/vfs/connected-resource-manifest"
import type { TabDescriptor } from "./types"
import { moduleForNodeKind } from "./node-kind-config"

export const RESOURCE_TAB_KIND = "resource"

function appendResourceParam(path: string, ref: ResourceRef): string {
  const [pathname, rawQuery = ""] = path.split("?", 2)
  const params = new URLSearchParams(rawQuery)
  params.set("resource", resourceKey(ref))
  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}

export function moduleForResource(ref: ResourceRef): TabDescriptor["module"] {
  switch (ref.scheme) {
    case "node":
      return moduleForNodeKind(ref.kind)
    case "info":
      return "info"
    case "community":
      return "community"
    case "tool":
      return "tool"
    case "browser":
      return "browser"
    case "app":
      return "apps"
  }
}

export function resourcePath(ref: ResourceRef, route?: string): string {
  if (ref.scheme === "node") {
    return `/home/notes?resource=${resourceQueryValue(ref)}`
  }
  return appendResourceParam(route ?? routeForConnectedResource(ref) ?? `/${ref.scheme}`, ref)
}

export function resourceTab(ref: ResourceRef, title?: string, route?: string): TabDescriptor {
  return {
    kind: RESOURCE_TAB_KIND,
    module: moduleForResource(ref),
    title: title || (ref.scheme === "node" ? ref.id : connectedResourceTitle(ref)),
    path: resourcePath(ref, route),
    params: { resource: resourceKey(ref) },
  }
}

export function resourceTabFromMeta(meta: ResourceMeta): TabDescriptor {
  return resourceTab(meta.ref, meta.title, meta.route)
}

export function parseResourceTabParams(params?: Record<string, string>): ResourceRef | null {
  const resource = parseResourceKey(params?.resource)
  if (resource) return resource

  const kind = params?.kind
  const id = params?.id
  if (!kind || !id || !isNodeKind(kind)) return null
  return { scheme: "node", kind, id }
}

export function isBrowserResourceTab(tab: Pick<TabDescriptor, "kind" | "params">): boolean {
  if (tab.kind === "browser-view") return true
  if (tab.kind !== RESOURCE_TAB_KIND) return false
  return parseResourceTabParams(tab.params)?.scheme === "browser"
}

export function nodeResourceRefForTab(
  tab: Pick<TabDescriptor, "kind" | "params"> | null | undefined,
): NodeResourceRef | null {
  if (!tab || (tab.kind !== RESOURCE_TAB_KIND && tab.kind !== "node")) return null
  const ref = parseResourceTabParams(tab.params)
  return ref?.scheme === "node" ? ref : null
}
