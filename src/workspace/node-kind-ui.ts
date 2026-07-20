"use client"

import * as React from "react"
import type { ComponentType } from "react"
import { FileText, Folder, Link2, Rss, ScrollText } from "lucide-react"
import type { NodeKind } from "./node-ref"
import type { TabLayout } from "./tab-definitions"

/** 节点查看器统一签名: 只收 nodeId, 内部自取数 + 自保存。 */
export type NodeViewerProps = { nodeId: string }

export type ViewerEntry = {
  viewer: React.LazyExoticComponent<React.ComponentType<NodeViewerProps>>
  /** 与 TabLayout 对齐: 笔记/文件预览=fill, 卡片类=padded。 */
  layout: TabLayout
}

type NodeKindUi = {
  icon: ComponentType<{ className?: string }>
  layout: TabLayout
  viewer?: React.LazyExoticComponent<React.ComponentType<NodeViewerProps>>
}

const NoteViewer = React.lazy(() => import("./viewers/note-viewer"))
const FileViewer = React.lazy(() => import("./viewers/file-viewer"))
const BookmarkViewer = React.lazy(() => import("./viewers/bookmark-viewer"))
const FeedViewer = React.lazy(() => import("./viewers/feed-viewer"))
const ThreadViewer = React.lazy(() => import("./viewers/thread-viewer"))

/**
 * NodeKind 的 UI 单源: 图标、默认布局与可打开查看器。
 * folder 是容器节点, 不提供 viewer; 侧栏点击负责展开。
 */
export const NODE_KIND_UI = {
  folder: { icon: Folder, layout: "padded" },
  note: { icon: FileText, layout: "fill", viewer: NoteViewer },
  bookmark: { icon: Link2, layout: "padded", viewer: BookmarkViewer },
  file: { icon: FileText, layout: "fill", viewer: FileViewer },
  feed: { icon: Rss, layout: "padded", viewer: FeedViewer },
  thread: { icon: ScrollText, layout: "fill", viewer: ThreadViewer },
} as const satisfies Record<NodeKind, NodeKindUi>

export function iconForNodeKind(kind: NodeKind): ComponentType<{ className?: string }> {
  return NODE_KIND_UI[kind].icon
}

/** 解析节点查看器; 容器或未接入的 kind 返回 null。 */
export function resolveViewer(kind: NodeKind): ViewerEntry | null {
  const entry: NodeKindUi = NODE_KIND_UI[kind]
  return entry.viewer ? { viewer: entry.viewer, layout: entry.layout } : null
}
