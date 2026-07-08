// 节点标签兼容构造器与反解。新打开路径统一走 kind="resource";
// parseNodeParams 继续支持旧 kind="node" 标签的 params={kind,id} hydration。
//
// path = /home/notes?resource=node:kind:id (收敛到单一静态壳 out/home/notes.html; query 不参与
// Tauri asset 寻址, 深链/刷新不 404)。URL 同步由 workspace-shell 的 <UrlSync/> 守护
// (pathname+search 比对 + descriptorForResource 优先), 收敛靠 tabKey 命中而非 URL 串比对,
// 不重演 dc7ce06 狂切。旧 ?node=kind:id 仍由 descriptorForResource 兼容读取。
import type { TabDescriptor } from "./types"
import { isNodeKind, type NodeKind, type NodeRef } from "./node-ref"
import { resourceTab } from "./resource-tab"

/** 由 NodeRef + 标题构造标签描述符。title 仅显示, 不入 tabKey (去重只看 kind+params)。 */
export function nodeTab(ref: NodeRef, title: string): TabDescriptor {
  return resourceTab({ scheme: "node", ...ref }, title || "无标题")
}

/** 反解标签 params → NodeRef (tab-host / registry / 水合校验用); 非法返回 null。 */
export function parseNodeParams(params?: Record<string, string>): NodeRef | null {
  const kind = params?.kind
  const id = params?.id
  if (!kind || !id || !isNodeKind(kind)) return null
  return { kind, id }
}
