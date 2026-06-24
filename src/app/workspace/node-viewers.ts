"use client"

// 节点查看器注册表 (一切皆标签): NodeKind → 懒加载查看器 (统一只收 nodeId, 内部自取数/自保存)。
// 与 registry.REGISTRY 平行: REGISTRY 管模块级面板 (无参), 此表管节点级查看器。
// P0 仅 note; 其余 kind 随四步折叠落地后逐个补 (未接入 → 返回 null → TabContent 显示「暂不支持」)。
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

const KIND_VIEWER: Partial<Record<NodeKind, ViewerEntry>> = {
  note: { viewer: NoteViewer, layout: "fill" },
}

/** 解析节点查看器; 未接入的 kind 返回 null。 */
export function resolveViewer(kind: NodeKind): ViewerEntry | null {
  return KIND_VIEWER[kind] ?? null
}
