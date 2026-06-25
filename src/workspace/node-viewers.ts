"use client"

// 节点查看器注册表 (一切皆标签): NodeKind → 懒加载查看器 (统一只收 nodeId, 内部自取数/自保存)。
// 与 registry.REGISTRY 平行: REGISTRY 管模块级面板 (无参), 此表管节点级查看器。
// note/file/bookmark/feed/thread 已接入; folder 无 viewer (容器, 侧栏点击=展开)。
import * as React from "react"
import type { NodeKind } from "./node-ref"

/** 节点查看器统一签名: 只收 nodeId, 内部自取数 + 自保存。 */
export type NodeViewerProps = { nodeId: string }

export type ViewerEntry = {
  viewer: React.LazyExoticComponent<React.ComponentType<NodeViewerProps>>
  /** 与 TabLayout 对齐: 笔记/文件预览=fill, 卡片类=padded。 */
  layout: "fill" | "padded"
}

const NoteViewer = React.lazy(() => import("./viewers/note-viewer"))
const FileViewer = React.lazy(() => import("./viewers/file-viewer"))
const BookmarkViewer = React.lazy(() => import("./viewers/bookmark-viewer"))
const FeedViewer = React.lazy(() => import("./viewers/feed-viewer"))
const ThreadViewer = React.lazy(() => import("./viewers/thread-viewer"))

const KIND_VIEWER: Partial<Record<NodeKind, ViewerEntry>> = {
  note: { viewer: NoteViewer, layout: "fill" },
  file: { viewer: FileViewer, layout: "fill" },
  bookmark: { viewer: BookmarkViewer, layout: "padded" },
  feed: { viewer: FeedViewer, layout: "padded" },
  thread: { viewer: ThreadViewer, layout: "fill" },
}

/** 解析节点查看器; 未接入的 kind 返回 null。 */
export function resolveViewer(kind: NodeKind): ViewerEntry | null {
  return KIND_VIEWER[kind] ?? null
}
