import type { ResourceRef } from "@protocol/resource"
import { parseResourceSearch } from "@protocol/resource"
import type { TabDescriptor } from "./types"
import { nodeTab } from "./node-tab"

export type OpenTarget =
  | { type: "resource"; ref: ResourceRef; title?: string; transient?: boolean }
  | { type: "tab"; descriptor: TabDescriptor; transient?: boolean }
  | { type: "command"; command: "open-ai-panel" | "toggle-right-panel" }

export function descriptorForResource(ref: ResourceRef, title?: string): TabDescriptor | null {
  switch (ref.scheme) {
    case "node":
      return nodeTab({ kind: ref.kind, id: ref.id }, title ?? ref.id)
    case "info":
    case "community":
    case "tool":
    case "browser":
    case "app":
      return null
  }
}

export function descriptorForResourceSearch(search: string): TabDescriptor | null {
  const ref = parseResourceSearch(search)
  return ref ? descriptorForResource(ref, ref.id) : null
}
