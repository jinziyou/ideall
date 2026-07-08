import type { NodeKind } from "./node-ref"
import type { ModuleId } from "./types"

/**
 * 节点 kind → 工作区模块归属。
 * 全部本地 node kind 归 "home": 它们都经「我的」places 文件树打开,
 * 保持本地视图与侧栏上下文连贯。
 */
export const NODE_KIND_MODULE = {
  note: "home",
  bookmark: "home",
  folder: "home",
  file: "home",
  feed: "home",
  thread: "home",
} as const satisfies Record<NodeKind, ModuleId>

export function moduleForNodeKind(kind: NodeKind): ModuleId {
  return NODE_KIND_MODULE[kind]
}
