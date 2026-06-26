// 统一节点模型 (一切皆文件) —— 所有本地优先内容收敛为单一命名空间里的可寻址节点。
// 见 docs/design/ai-native-redesign.md §2。纯类型 + 零依赖运行期守卫 (不引 platejs/编辑器):
//   - kind 为主辨识 (不设顶层 mime; file 用 blobRef.mime);
//   - 可辨识联合杀掉 content:unknown 的类型逃逸; note 的 unknown[] 是协议纯度被迫且合理的妥协;
//   - 折叠分步进行 (§3): 步 A 仅 note 物理入库, 其余 kind 类型先就位、随后续折叠落库。
import type { NoteContent } from "./files"
import type { SubscriptionType } from "./subscription"

export type NodeKind = "folder" | "note" | "bookmark" | "file" | "feed" | "thread"

/** 节点引用: 一个节点的稳定句柄 (kind + 不透明 id)。寻址真相 = id; nodePath 是沿 parentId 派生的可变视图。 */
export interface NodeRef {
  kind: NodeKind
  id: string
}

/** Blob 旁存引用 (file 专用): 大二进制存独立 blobs 仓库, 不进节点同步块。 */
export interface BlobRef {
  store: "blobs"
  key: string
  size: number
  mime: string
}

/** 所有 kind 共有的基座 —— 结构上满足 @protocol/sync 的 SyncRecord (id + updatedAt + deletedAt)。 */
export interface BaseNode {
  id: string
  /** 父节点 id (复用 Note 树语义); 合成单根树下 null 只属唯一根。 */
  parentId: string | null
  /** 同级排序键 (fractional index, 见 sort-key.ts)。 */
  sortKey: string
  title: string
  tags: string[]
  createdAt: number
  /** 最后编辑时间戳, 毫秒 (LWW)。 */
  updatedAt: number
  /** 软删除墓碑 (epoch ms); 缺省 = 活跃。删除靠墓碑跨端传播 (见 @protocol/sync)。 */
  deletedAt?: number
  /** kind 专属的额外元数据 (按需)。 */
  meta?: Record<string, unknown>
}

/** 统一节点 —— 按 kind 的可辨识联合。 */
export type Node = BaseNode &
  (
    | { kind: "folder"; content?: null }
    | { kind: "note"; content: NoteContent } // Plate Value (协议不依赖 platejs)
    | { kind: "bookmark"; content: { url: string; description: string; favicon: string } }
    | { kind: "file"; blobRef: BlobRef; content?: null } // Blob 旁存 blobs 仓库, 不进同步
    | {
        kind: "feed"
        content: {
          type: SubscriptionType
          key: string
          favicon: string
          entityLabel?: string
          entityName?: string
          searchKeyword?: string
          searchDomain?: string
        }
      }
    | { kind: "thread"; content: { messages: unknown[] } }
  )

/** 取某 kind 对应的节点子类型, 如 NodeOfKind<"note">。 */
export type NodeOfKind<K extends NodeKind> = Extract<Node, { kind: K }>

/** fs.create 入参 (AI fs.* 写面 §6.1): content 用对应 kind 的 Node content 形态。 */
export type FsCreateInput = {
  kind: NodeKind
  parentId?: string | null
  title?: string
  tags?: string[]
  content?: unknown
}

/** fs.write 补丁 (只改给定字段)。 */
export type FsWritePatch = {
  title?: string
  tags?: string[]
  content?: unknown
  parentId?: string | null
}

/** 笔记节点 —— 折叠步 A 唯一物理入库的 kind。 */
export type NoteNode = NodeOfKind<"note">

/** 全部 NodeKind 的**单一真相源**。tools.ts 的 zod enum、nodes-store 的 ALL_NODE_KINDS 等一律从此派生, 杜绝多份手抄漂移。 */
export const NODE_KINDS: readonly NodeKind[] = [
  "folder",
  "note",
  "bookmark",
  "file",
  "feed",
  "thread",
]

/** 运行期校验 (反序列化标签 params / 深链 / 水合时用)。 */
export function isNodeKind(k: string): k is NodeKind {
  return (NODE_KINDS as readonly string[]).includes(k)
}

/**
 * 隐私净化 (单一函数, fs.list 工具与 fs://nodes 资源同点复用, 防净化漂移; 见设计 §6.3):
 * note 剥正文 content, thread 剥 messages —— 批量列举永不回私密正文/会话 (即便消费方持 fs.notes:read)。
 * 其余 kind (folder/bookmark/file/feed) 的 content 非私密正文, 原样返回。纯函数, 不依赖存储。
 *
 * 用穷尽 switch (无 default) 锁死隐私决策: 新增 NodeKind 而未在此显式分类, 会因缺返回路径
 * 而**编译失败** —— 防「加 kind 忘判私密 → 静默原样放行 → 批量列举泄漏」(红队 §must-fix)。
 */
export function stripNode(n: Node): Node {
  switch (n.kind) {
    case "note":
      return { ...n, content: [] }
    case "thread":
      return { ...n, content: { messages: [] } }
    case "folder":
    case "bookmark":
    case "file":
    case "feed":
      return n
  }
}
