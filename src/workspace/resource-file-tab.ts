import type { ResourceRef } from "@protocol/resource"
import { resourceFileRef } from "@/filesystem/resource-file-system"
import { fileEngineTab } from "./file-tab"
import { moduleForResource, resourcePath } from "./resource-tab"
import type { TabDescriptor } from "./types"

export function engineForResource(ref: ResourceRef): string {
  if (ref.scheme === "node") {
    if (ref.kind === "note") return "ideall.note"
    if (ref.kind === "bookmark") return "ideall.bookmark"
    if (ref.kind === "feed") return "ideall.feed"
    if (ref.kind === "thread") return "ideall.thread"
    if (ref.kind === "folder") return "ideall.directory"
    return "ideall.preview"
  }
  if (ref.scheme === "browser") return "ideall.browser"
  return "ideall.connected"
}

export function rootForResource(ref: ResourceRef): string {
  if (ref.scheme === "node") {
    return ref.kind === "thread" ? "activity" : "home"
  }
  if (ref.scheme === "browser" || ref.scheme === "info" || ref.scheme === "community") {
    return "browse"
  }
  if (ref.scheme === "app") return "apps"
  if (ref.scheme === "tool") return "apps"
  return "home"
}

/** 当前运行时入口：ResourceRef 先映射为 FileRef，再生成唯一的 File + Engine 标签身份。 */
export function resourceFileTab(ref: ResourceRef, title?: string): TabDescriptor {
  return fileEngineTab(
    { ref: resourceFileRef(ref), name: title || ref.id },
    engineForResource(ref),
    { module: moduleForResource(ref), rootId: rootForResource(ref), path: resourcePath(ref) },
  )
}
