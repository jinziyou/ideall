import type { ResourceRef } from "@protocol/resource"
import type { FileRef, IdeallFile } from "@protocol/file-system"
import { parseResourceSearch } from "@protocol/resource"
import type { TabDescriptor } from "./types"
import { resourceFileTab } from "./resource-file-tab"

export type OpenTarget =
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

export function descriptorForResource(ref: ResourceRef, title?: string): TabDescriptor | null {
  return resourceFileTab(ref, title)
}

export function descriptorForResourceSearch(search: string): TabDescriptor | null {
  const ref = parseResourceSearch(search)
  return ref ? descriptorForResource(ref, ref.scheme === "node" ? ref.id : undefined) : null
}
