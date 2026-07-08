import type { ResourceMeta, ResourceRef } from "@protocol/resource"
import { parseResourceSearch, resourceKey } from "@protocol/resource"
import { routeForConnectedResource } from "@/vfs/connected-resource-manifest"
import type { TabDescriptor } from "./types"
import { nodeTab } from "./node-tab"
import { tabDescriptor } from "./tab-definitions"

export type OpenTarget =
  | { type: "resource"; ref: ResourceRef; title?: string; meta?: ResourceMeta; transient?: boolean }
  | { type: "tab"; descriptor: TabDescriptor; transient?: boolean }
  | { type: "command"; command: "open-ai-panel" | "toggle-right-panel" }

export function descriptorForResource(
  ref: ResourceRef,
  title?: string,
  route?: string,
): TabDescriptor | null {
  switch (ref.scheme) {
    case "node":
      return nodeTab({ kind: ref.kind, id: ref.id }, title ?? ref.id)
    case "info": {
      const path = route ?? routeForConnectedResource(ref) ?? "/info"
      return tabDescriptor("info", {
        title: title ?? (ref.kind === "home" ? "资讯" : ref.id),
        path,
        params: { resource: resourceKey(ref) },
      })
    }
    case "community": {
      const path = route ?? routeForConnectedResource(ref) ?? "/community"
      return tabDescriptor("community", {
        title: title ?? (ref.kind === "home" ? "社区" : ref.id),
        path,
        params: { resource: resourceKey(ref) },
      })
    }
    case "tool":
      if (ref.kind === "search") return tabDescriptor("tool-search", { title })
      if (ref.kind === "ai") return tabDescriptor("tool-ai", { title })
      if (ref.kind === "navigation") return tabDescriptor("tool-navigation", { title })
      return null
    case "browser":
      return tabDescriptor("browser-view", {
        title: title ?? "浏览器",
        params: { resource: resourceKey(ref) },
      })
    case "app":
      return tabDescriptor("apps", {
        title: title ?? ref.id,
        params: { resource: resourceKey(ref) },
      })
  }
}

export function descriptorForResourceMeta(meta: ResourceMeta): TabDescriptor | null {
  return descriptorForResource(meta.ref, meta.title, meta.route)
}

export function descriptorForResourceSearch(search: string): TabDescriptor | null {
  const ref = parseResourceSearch(search)
  return ref ? descriptorForResource(ref, ref.id) : null
}
