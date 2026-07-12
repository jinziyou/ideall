// 本机内容 (文件 / 关注 / 书签 / 资源 / 对话) 的可搜索条目: 唯一数据来源, 供 ⌘K 统一面板消费
// (顶栏搜索框唤起同一面板; 旧的独立本地搜索对话框已并入)。每项含 run() 执行:
// 所有本机内容先作为 FileSystem 目录项加载, 再打开对应文件标签。

import type { ComponentType } from "react"
import { MessagesSquare } from "lucide-react"
import { fileRefKey, type DirectoryEntry } from "@protocol/file-system"
import { walkFileDirectory } from "@/filesystem/directory-walk"
import {
  corePlaceRef,
  resourceRefForFile,
  type CorePlaceId,
} from "@/filesystem/resource-file-system"
import { MODULE_META } from "./module-meta"
import { openTarget } from "./store"
import type { OpenTarget } from "./open-target"

export type LocalSearchGroup = "文件" | "关注" | "书签" | "资源" | "对话"
export type LocalSearchItem = {
  id: string
  label: string
  group: LocalSearchGroup
  fileType?: { name: string; type: string }
  target?: OpenTarget
  run: () => void
}

export const LOCAL_SEARCH_ORDER: LocalSearchGroup[] = ["文件", "关注", "书签", "资源", "对话"]

// 图标从 MODULE_META 派生 (分组名是本文件的展示口径, 与模块 label 恰好一致但语义独立)。
export const LOCAL_SEARCH_ICON: Record<LocalSearchGroup, ComponentType<{ className?: string }>> = {
  文件: MODULE_META.notes.icon,
  关注: MODULE_META.subscriptions.icon,
  书签: MODULE_META.bookmarks.icon,
  资源: MODULE_META.resources.icon,
  对话: MessagesSquare,
}

export type LocalSearchSource = {
  group: LocalSearchGroup
  place: CorePlaceId
  kind: "note" | "feed" | "bookmark" | "file" | "thread"
  descendKind?: "note" | "folder"
}

const LOCAL_SEARCH_SOURCES: LocalSearchSource[] = [
  { group: "文件", place: "notes", kind: "note", descendKind: "note" },
  { group: "关注", place: "subscriptions", kind: "feed" },
  { group: "书签", place: "bookmarks", kind: "bookmark", descendKind: "folder" },
  { group: "资源", place: "files", kind: "file" },
  { group: "对话", place: "workspace", kind: "thread" },
]

export type LoadLocalSearchItemsOptions = {
  text?: string
  limitPerGroup?: number
}

function runTarget(target: OpenTarget): () => void {
  return () => openTarget(target)
}

function itemFromEntry(group: LocalSearchGroup, entry: DirectoryEntry): LocalSearchItem {
  const target: OpenTarget = { type: "file", ref: entry.target, title: entry.name }
  const resource = resourceRefForFile(entry.target)
  const fileType =
    resource?.scheme === "node" && resource.kind === "file"
      ? {
          name: entry.name,
          type: typeof entry.properties?.mediaType === "string" ? entry.properties.mediaType : "",
        }
      : undefined
  return {
    id: fileRefKey(entry.target),
    label: entry.name,
    group,
    ...(fileType ? { fileType } : {}),
    target,
    run: runTarget(target),
  }
}

export type LocalSearchEntryLoader = (
  source: LocalSearchSource,
  options: LoadLocalSearchItemsOptions,
) => Promise<DirectoryEntry[]>

const DIRECTORY_CONTEXT = { actor: "ui", permissions: [], intent: "directory" } as const

async function loadFileEntries(
  source: LocalSearchSource,
  { text, limitPerGroup }: LoadLocalSearchItemsOptions,
): Promise<DirectoryEntry[]> {
  const normalizedText = text?.trim().toLocaleLowerCase()
  const entries = await walkFileDirectory(
    corePlaceRef(source.place),
    DIRECTORY_CONTEXT,
    (entry) => {
      const resource = resourceRefForFile(entry.target)
      return Boolean(
        source.descendKind && resource?.scheme === "node" && resource.kind === source.descendKind,
      )
    },
  )
  const matches = entries.filter((entry) => {
    const resource = resourceRefForFile(entry.target)
    return (
      resource?.scheme === "node" &&
      resource.kind === source.kind &&
      (!normalizedText || entry.name.toLocaleLowerCase().includes(normalizedText))
    )
  })
  return limitPerGroup == null ? matches : matches.slice(0, Math.max(0, limitPerGroup))
}

async function loadFileGroup(
  source: LocalSearchSource,
  options: LoadLocalSearchItemsOptions,
  loader: LocalSearchEntryLoader,
): Promise<LocalSearchItem[]> {
  try {
    return (await loader(source, options)).map((entry) => itemFromEntry(source.group, entry))
  } catch {
    return []
  }
}

/** 并行加载本机内容并构建可搜索/可执行条目 (按 文件→关注→书签→资源→对话 顺序)。 */
export async function loadLocalSearchItems(
  options: LoadLocalSearchItemsOptions = {},
  loader: LocalSearchEntryLoader = loadFileEntries,
): Promise<LocalSearchItem[]> {
  const groups = await Promise.all(
    LOCAL_SEARCH_SOURCES.map((source) => loadFileGroup(source, options, loader)),
  )
  return groups.flat()
}
