import type { ResourceMeta, ResourceRef } from "@protocol/resource"
import type { FileRef, IdeallFile } from "@protocol/file-system"
import { parseResourceSearch } from "@protocol/resource"
import type { TabDescriptor } from "./types"
import { resourceTab, resourceTabFromMeta } from "./resource-tab"

export type OpenTarget =
  | { type: "resource"; ref: ResourceRef; title?: string; meta?: ResourceMeta; transient?: boolean }
  | {
      type: "file"
      ref: FileRef
      file?: IdeallFile
      engineId?: string
      title?: string
      transient?: boolean
      display?: "tab" | "window"
      /** 从某个活动栏根目录打开时保留该空间锚点。 */
      rootId?: string
    }
  | { type: "tab"; descriptor: TabDescriptor; transient?: boolean }
  | { type: "command"; command: "open-ai-panel" | "toggle-right-panel" }

export function descriptorForResource(
  ref: ResourceRef,
  title?: string,
  route?: string,
): TabDescriptor | null {
  return resourceTab(ref, title, route)
}

export function descriptorForResourceMeta(meta: ResourceMeta): TabDescriptor | null {
  return resourceTabFromMeta(meta)
}

export function descriptorForResourceSearch(search: string): TabDescriptor | null {
  const ref = parseResourceSearch(search)
  return ref ? descriptorForResource(ref, ref.scheme === "node" ? ref.id : undefined) : null
}
