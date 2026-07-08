import type { ResourceRef } from "@protocol/resource"
import { parseResourceSearch, resourceKey } from "@protocol/resource"
import { routeForConnectedResource } from "@/vfs/connected-providers"
import type { TabDescriptor } from "./types"
import { nodeTab } from "./node-tab"
import { tabDescriptor } from "./tab-definitions"

export type OpenTarget =
  | { type: "resource"; ref: ResourceRef; title?: string; transient?: boolean }
  | { type: "tab"; descriptor: TabDescriptor; transient?: boolean }
  | { type: "command"; command: "open-ai-panel" | "toggle-right-panel" }

export function descriptorForResource(ref: ResourceRef, title?: string): TabDescriptor | null {
  switch (ref.scheme) {
    case "node":
      return nodeTab({ kind: ref.kind, id: ref.id }, title ?? ref.id)
    case "info": {
      const route = routeForConnectedResource(ref) ?? "/info"
      return tabDescriptor("info", {
        title: title ?? (ref.kind === "home" ? "资讯" : ref.id),
        path: route,
        params: { resource: resourceKey(ref) },
      })
    }
    case "community": {
      const route = routeForConnectedResource(ref) ?? "/community"
      return tabDescriptor("community", {
        title: title ?? (ref.kind === "home" ? "社区" : ref.id),
        path: route,
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

export function descriptorForResourceSearch(search: string): TabDescriptor | null {
  const ref = parseResourceSearch(search)
  return ref ? descriptorForResource(ref, ref.id) : null
}
