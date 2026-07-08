"use client"

// 节点查看器注册表 (一切皆标签): NodeKind → 懒加载查看器 (统一只收 nodeId, 内部自取数/自保存)。
// 实现已收口到 node-kind-ui; 保留本文件作为历史导入路径。
export type { NodeViewerProps, ViewerEntry } from "./node-kind-ui"
export { resolveViewer } from "./node-kind-ui"
