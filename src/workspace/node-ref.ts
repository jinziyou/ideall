// 节点逻辑寻址层 (一切皆文件): 定义「如何指向一个节点」, 不涉存储。
// 类型与运行期守卫统一到 @protocol/node (唯一数据来源, 与数据层/AI 层共用); 此处只补 UI 深链编解码。
// 深链查询编解码 (refToQuery/parseNodeQuery) 随 workspace-shell 的 pathname+search 守护一起用。
import { isNodeKind, type NodeKind, type NodeRef } from "@protocol/node"

export { isNodeKind }
export type { NodeKind, NodeRef }

/** NodeRef → 深链查询值 node=kind:id。id 经 encodeURIComponent (防 feed key / search 含 & = :)。 */
export function refToQuery(ref: NodeRef): string {
  return `${ref.kind}:${encodeURIComponent(ref.id)}`
}

/** 解析 ?node=kind:id → NodeRef; 非法/缺省返回 null。只切第一个冒号 (id 内含冒号也安全)。 */
export function parseNodeQuery(raw: string | null | undefined): NodeRef | null {
  if (!raw) return null
  const i = raw.indexOf(":")
  if (i <= 0) return null
  const kind = raw.slice(0, i)
  const id = decodeURIComponent(raw.slice(i + 1))
  if (!isNodeKind(kind) || !id) return null
  return { kind, id }
}
