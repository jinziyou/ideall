// 节点标签的唯一构造器与反解 (一切皆标签): 三入口 (搜索/侧栏/AI) 必须都经 nodeTab,
// 保证 kind 恒 "node"、params 恒 {kind,id} → tabKey 据此 entity 级去重 (同节点复用同标签)。
//
// P0: 刻意不设 path —— 节点标签不参与 workspace-shell 的 URL 同步, 避免在其做出
// pathname+search 守护前重演 dc7ce06「页面自动狂切」。刷新恢复靠 sessionStorage 水合;
// 可分享深链 (?node=kind:id) + URL 守护留 P0b。
import type { ModuleId, TabDescriptor } from "./types"
import { isNodeKind, type NodeKind, type NodeRef } from "./node-ref"

/** 节点 kind → 归属模块 (驱动活动栏高亮 / 模式镜头 / 标签色点)。 */
const MODULE_OF_KIND: Record<NodeKind, ModuleId> = {
  note: "home",
  bookmark: "home",
  folder: "home",
  file: "home",
  feed: "subscriptions",
  thread: "agent",
}

/** 由 NodeRef + 标题构造标签描述符。title 仅显示, 不入 tabKey (去重只看 kind+params)。 */
export function nodeTab(ref: NodeRef, title: string): TabDescriptor {
  return {
    kind: "node",
    module: MODULE_OF_KIND[ref.kind],
    title: title || "无标题",
    params: { kind: ref.kind, id: ref.id },
  }
}

/** 反解标签 params → NodeRef (tab-host / registry / 水合校验用); 非法返回 null。 */
export function parseNodeParams(params?: Record<string, string>): NodeRef | null {
  const kind = params?.kind
  const id = params?.id
  if (!kind || !id || !isNodeKind(kind)) return null
  return { kind, id }
}
