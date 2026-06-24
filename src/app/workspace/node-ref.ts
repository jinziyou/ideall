// 节点逻辑寻址层 (一切皆文件): 定义「如何指向一个节点」, 不涉存储。
// P0 仅 note 接入; 类型为全 kind, 前向兼容后续折叠 (见 docs/design/ai-native-redesign.md)。
// 深链查询编解码 (refToQuery/parseNodeQuery) 留 P0b (随 workspace-shell 的 pathname+search 守护一起上)。
export type NodeKind = "folder" | "note" | "bookmark" | "file" | "feed" | "thread"

/** 节点引用: 一个节点的稳定句柄。序列化进标签 params (去重), 未来也进深链查询。 */
export interface NodeRef {
  kind: NodeKind
  id: string
}

const NODE_KINDS: readonly NodeKind[] = ["folder", "note", "bookmark", "file", "feed", "thread"]

/** 运行期校验 (反序列化标签 params / 水合时用)。 */
export function isNodeKind(k: string): k is NodeKind {
  return (NODE_KINDS as readonly string[]).includes(k)
}
