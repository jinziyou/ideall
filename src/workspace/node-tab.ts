// 节点标签的唯一构造器与反解 (一切皆标签): 三入口 (搜索/侧栏/AI) 必须都经 nodeTab,
// 保证 kind 恒 "node"、params 恒 {kind,id} → tabKey 据此 entity 级去重 (同节点复用同标签)。
//
// path = /home/notes?node=kind:id (收敛到单一静态壳 out/home/notes.html; query 不参与 Tauri asset
// 寻址, 深链/刷新不 404)。URL 同步由 workspace-shell 的 <UrlSync/> 守护 (pathname+search 比对 +
// descriptorForNode 优先), 收敛靠 tabKey 命中而非 URL 串比对, 不重演 dc7ce06 狂切。
import type { ModuleId, TabDescriptor } from "./types"
import { isNodeKind, refToQuery, type NodeKind, type NodeRef } from "./node-ref"

/**
 * 节点 kind → 归属模块 (驱动活动栏高亮 / 模式视图 / 标签色点)。
 * 全部本地 node kind 归 "home": 它们都经「我的」的 places 文件树打开, 归 home 保持 places 侧栏连贯,
 * 且不切走视图 (thread 归 local 视图、移除 agent 的 connected 归属, 见设计 §1; feed 同理不跳关注模块)。
 */
const MODULE_OF_KIND: Record<NodeKind, ModuleId> = {
  note: "home",
  bookmark: "home",
  folder: "home",
  file: "home",
  feed: "home",
  thread: "home",
}

/** 由 NodeRef + 标题构造标签描述符。title 仅显示, 不入 tabKey (去重只看 kind+params)。 */
export function nodeTab(ref: NodeRef, title: string): TabDescriptor {
  return {
    kind: "node",
    module: MODULE_OF_KIND[ref.kind],
    title: title || "无标题",
    path: `/home/notes?node=${refToQuery(ref)}`,
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
