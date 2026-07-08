// 本机内容 (笔记 / 关注 / 书签 / 资源 / 对话) 的可搜索条目: 唯一数据来源, 供 ⌘K 统一面板消费
// (顶栏搜索框唤起同一面板; 旧的独立本地搜索对话框已并入)。每项含 run() 执行:
// 所有本机内容先作为 VFS ResourceMeta 加载, 再打开对应 resource 标签。

import type { ComponentType } from "react"
import { MessagesSquare } from "lucide-react"
import { resourceKey, type ResourceMeta } from "@protocol/resource"
import { listResources } from "@/vfs/registry"
import type { ResourceQuery } from "@/vfs/types"
import { MODULE_META } from "./module-meta"
import { openTarget } from "./store"
import type { OpenTarget } from "./open-target"

export type LocalSearchGroup = "笔记" | "关注" | "书签" | "资源" | "对话"
export type LocalSearchItem = {
  id: string
  label: string
  group: LocalSearchGroup
  fileType?: { name: string; type: string }
  target?: OpenTarget
  run: () => void
}

export const LOCAL_SEARCH_ORDER: LocalSearchGroup[] = ["笔记", "关注", "书签", "资源", "对话"]

// 图标从 MODULE_META 派生 (分组名是本文件的展示口径, 与模块 label 恰好一致但语义独立)。
export const LOCAL_SEARCH_ICON: Record<LocalSearchGroup, ComponentType<{ className?: string }>> = {
  笔记: MODULE_META.notes.icon,
  关注: MODULE_META.subscriptions.icon,
  书签: MODULE_META.bookmarks.icon,
  资源: MODULE_META.resources.icon,
  对话: MessagesSquare,
}

const NODE_SEARCH_QUERIES: Array<{ group: LocalSearchGroup; query: ResourceQuery }> = [
  { group: "笔记", query: { scheme: "node", kind: "note" } },
  { group: "关注", query: { scheme: "node", kind: "feed" } },
  { group: "书签", query: { scheme: "node", kind: "bookmark" } },
  { group: "资源", query: { scheme: "node", kind: "file" } },
  { group: "对话", query: { scheme: "node", kind: "thread" } },
]

export type LoadLocalSearchItemsOptions = {
  text?: string
  limitPerGroup?: number
}

function runTarget(target: OpenTarget): () => void {
  return () => openTarget(target)
}

function itemFromResource(group: LocalSearchGroup, meta: ResourceMeta): LocalSearchItem {
  const target: OpenTarget = { type: "resource", ref: meta.ref, title: meta.title, meta }
  const fileType =
    meta.ref.scheme === "node" && meta.ref.kind === "file"
      ? { name: meta.title, type: meta.iconHint ?? "" }
      : undefined
  return {
    id: resourceKey(meta.ref),
    label: meta.title,
    group,
    ...(fileType ? { fileType } : {}),
    target,
    run: runTarget(target),
  }
}

async function loadResourceGroup(
  group: LocalSearchGroup,
  query: ResourceQuery,
  { text, limitPerGroup }: LoadLocalSearchItemsOptions,
): Promise<LocalSearchItem[]> {
  try {
    const normalizedText = text?.trim()
    const page = await listResources(
      {
        ...query,
        ...(normalizedText ? { text: normalizedText } : {}),
        ...(limitPerGroup != null ? { limit: limitPerGroup } : {}),
      },
      { actor: "ui", permissions: [], intent: "metadata" },
    )
    return page.items.map((meta) => itemFromResource(group, meta))
  } catch {
    return []
  }
}

/** 并行加载本机内容并构建可搜索/可执行条目 (按 笔记→关注→书签→资源→对话 顺序)。 */
export async function loadLocalSearchItems(
  options: LoadLocalSearchItemsOptions = {},
): Promise<LocalSearchItem[]> {
  const groups = await Promise.all(
    NODE_SEARCH_QUERIES.map(({ group, query }) => loadResourceGroup(group, query, options)),
  )
  return groups.flat()
}
