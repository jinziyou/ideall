// 「我的」本地数据接口约定 —— core 拥有的本地优先实体 (资源 / 书签 / 收藏夹 / 笔记 / 对话)。
// 这些类型既是 core 存储模型, 又经 FilesPort 暴露给 plugin (如 agent), 故属接口约定。
// (关注 Subscription 类型见 ./subscription)。
import type { Subscription, SubscriptionType, NewSubscription } from "./subscription"
import type { Node, NodeKind, FsCreateInput, FsWritePatch } from "./node"
import type { BlockMetaMap } from "./note-merge"

/** 本地存储的文件: 元数据 + 原始 Blob */
export interface StoredFile {
  id: string
  name: string
  /** MIME 类型, 可能为空字符串 */
  type: string
  /** 字节数 */
  size: number
  /** 原始文件内容 */
  blob: Blob
  /** 创建 (上传) 时间戳, 毫秒 */
  createdAt: number
  /** 用户标签 */
  tags: string[]
}

/** 不含 blob 的文件元数据, 用于列表展示, 避免一次性把所有大文件读入内存 */
export type FileMeta = Omit<StoredFile, "blob">

/** 链接收藏夹 (分组), 类似浏览器书签文件夹 */
export interface BookmarkFolder {
  id: string
  name: string
  createdAt: number
}

/** 链接收藏 */
export interface Bookmark {
  id: string
  title: string
  url: string
  description: string
  /** 站点图标 URL (favicon), 导入或自动推断 */
  favicon: string
  /** 所属收藏夹 id; null 表示未分组 */
  folderId: string | null
  /** 用户标签 */
  tags: string[]
  createdAt: number
}

/** 新建书签入参 (id/createdAt 由实现补全)。 */
export type NewBookmark = {
  title: string
  url: string
  description?: string
  favicon?: string
  folderId?: string | null
  tags?: string[]
}

/**
 * 笔记正文 —— 类 Notion 块文档, 由块节点构成的数组 (Plate/Slate 值)。
 * JSON 可序列化, 直存 IndexedDB。protocol 不依赖编辑器实现 (platejs), 故以结构化 unknown[] 表达;
 * 编辑器封装层再断言为 Plate 的 Value。
 */
export type NoteContent = unknown[]

/**
 * 笔记 (本地优先的原创块文档) —— Notion 式「目录即页面」递归节点:
 * 任一 Note 既是页面 (有 content) 又是目录 (可作其它 Note 的父), 经 parentId 无限嵌套。
 * 结构上满足 @protocol/sync 的 SyncRecord (id + updatedAt + deletedAt), 故复用同一套 LWW 跨端合并。
 */
export interface Note {
  id: string
  title: string
  /** 块文档正文 (Plate 值) */
  content: NoteContent
  /** 父页面 id; null = 根页面 (取代旧 notebookId)。任意 Note 可为其它 Note 的父 → 递归页树。 */
  parentId: string | null
  /**
   * 同级排序键 (fractional-indexing 字符串, 字典序即显示序; 仅在同 parentId 下比较)。
   * 移动 / 重排只改本节点一行 → 与单行 idbPut 及跨端 LWW 同步天然兼容。
   */
  sortKey: string
  /** 用户标签 */
  tags: string[]
  createdAt: number
  /** 最后编辑时间戳, 毫秒 (LWW 比较 + 同级排序回退) */
  updatedAt: number
  /** 软删除标记 (epoch ms); 缺省 = 活跃。跨端同步靠删除标记传播删除 (见 @protocol/sync)。 */
  deletedAt?: number
  /**
   * 块级并发元数据 sidecar (§7): 按顶层块 id 记 {v,by,sk,del?}, 与 content 并列。
   * 跨端同步走块级合并 (@protocol/note-merge); 缺省 (旧记录/未迁移) 时按整篇 LWW 兜底。
   */
  blockMeta?: BlockMetaMap
}

/** 笔记列表元数据 —— 不含完整 content, 改带纯文本摘要/全文, 避免列表整块载入正文 */
export type NoteMeta = Omit<Note, "content"> & {
  /** 正文前若干字符的纯文本, 用于列表卡片展示 */
  excerpt: string
  /** 正文全文纯文本 (不含格式), 用于全文搜索 */
  search: string
  /** 是否有活跃子页面 (决定页树展开箭头; 由 listNotes 一次性内存聚合得出, 免逐节点 count) */
  hasChildren: boolean
}

/**
 * AI 助手对话线程 (core 存储视角) —— 消息语义属 agent 插件域, 协议层以 unknown[] 表达
 * (同 NoteContent 不依赖编辑器实现)。插件经 FilesPort 读写, 在边界断言 messages 为其 AgentMessage[]。
 * 本地独占, 默认不跨端同步 (对象级 LWW 会截断 messages[]; 见 docs/design/ai-native-redesign.md §3 步 D)。
 */
export interface Thread {
  id: string
  title: string
  messages: unknown[]
  createdAt: number
  updatedAt: number
}

/** 新建笔记入参 (id/时间戳/sortKey 由实现补全; 均可选, content 缺省为空文档)。 */
export type NewNote = {
  title?: string
  content?: NoteContent
  /** 父页面 id; null / 缺省 = 根页面 */
  parentId?: string | null
  /** 插入到某兄弟之后 (拖拽 / 在某页下方新建); 缺省追加同级末尾 */
  afterSortKey?: string | null
  tags?: string[]
}

/**
 * 「我的」本地数据端口 —— core 实现 (包装 IndexedDB stores), 经 protocol 暴露给 plugin。
 * agent 插件经此读写用户的关注 / 书签 / 收藏夹 / 资源, 而非直接依赖 core 存储 (依赖反转)。
 */
export interface FilesPort {
  // 关注
  /** 列出活跃关注 (过滤软删除标记)。UI / 插件读路径。 */
  listSubscriptions(): Promise<Subscription[]>
  /** 列出全部关注含删除标记 —— 跨端同步合并用 (删除标记须进合并/上传才能传播删除)。 */
  listAllSubscriptions(): Promise<Subscription[]>
  addSubscription(input: NewSubscription): Promise<Subscription>
  removeSubscription(type: SubscriptionType, key: string): Promise<void>
  isSubscribed(type: SubscriptionType, key: string): Promise<boolean>
  /** 跨端同步落地: 写入合并 + GC 后的完整数据, 并物理清除集合外的过期删除标记 (一次事务批处理)。 */
  bulkPutSubscriptions(subs: Subscription[]): Promise<void>
  // 书签 / 收藏夹
  listBookmarks(): Promise<Bookmark[]>
  addBookmark(input: NewBookmark): Promise<Bookmark>
  updateBookmark(id: string, patch: Partial<Omit<Bookmark, "id" | "createdAt">>): Promise<void>
  deleteBookmark(id: string): Promise<void>
  listFolders(): Promise<BookmarkFolder[]>
  addFolder(name: string): Promise<BookmarkFolder>
  // 资源文件
  listFiles(): Promise<FileMeta[]>
  updateFileMeta(id: string, patch: Partial<Pick<StoredFile, "name" | "tags">>): Promise<void>
  // 笔记 (读接口, 供插件读取「我的」笔记; 写接口暂不开放给插件)
  /** 列出活跃笔记元数据 (过滤删除标记)。 */
  listNotes(): Promise<NoteMeta[]>
  getNote(id: string): Promise<Note | undefined>
  /** 列出某父页下的活跃直接子页面 (元数据, 按同级序), 供树感知插件导航。 */
  listNoteChildren(parentId: string | null): Promise<NoteMeta[]>
  /** 列出全部笔记含删除标记 + 完整正文 —— 跨端同步合并/上传用 (读路径另有 listNotes 过滤删除标记)。 */
  listAllNotes(): Promise<Note[]>
  /** 跨端同步落地: 写入合并 + GC 后的完整数据 (一次事务批处理)。 */
  bulkPutNotes(notes: Note[]): Promise<void>
  // 对话线程 (agent 插件经此读写, 不直接依赖 core 存储; 本地独占, 默认不同步, 硬删)
  /** 线程列表, 按最近更新倒序。 */
  listThreads(): Promise<Thread[]>
  getThread(id: string): Promise<Thread | undefined>
  /** 新建空线程并落库。 */
  createThread(): Promise<Thread>
  /** 整体写回线程 (消息内联, 调用方在内存改好 messages 后调用); 刷新 updatedAt。 */
  saveThread(thread: Thread): Promise<void>
  /** 物理删除 (线程本地独占, 无需删除标记传播)。 */
  deleteThread(id: string): Promise<void>
  renameThread(id: string, title: string): Promise<void>
  // 统一 Node 文件面 (AI fs.* §6): 跨 kind 寻址读 (原始节点, 调用方按 kind gate / stripNode 净化)。
  /** 列出指定 kind 的活跃完整节点 (fs.list 后端)。 */
  fsListNodes(kinds: NodeKind[]): Promise<Node[]>
  /** 取单个活跃完整节点 (fs.read 后端); 不存在 / 删除标记 → undefined。 */
  fsGetNode(id: string): Promise<Node | undefined>
  /** fs.create 后端: 按 kind 新建, 回读为 Node (file 不可创建)。 */
  fsCreateNode(input: FsCreateInput): Promise<Node>
  /** fs.write 后端: 按 kind 改字段, 回读为 Node。 */
  fsUpdateNode(kind: NodeKind, id: string, patch: FsWritePatch): Promise<Node | undefined>
  /** fs.move 后端: 改父 + 同级位置 (note 树 / bookmark 归夹)。 */
  fsMoveNode(
    kind: NodeKind,
    id: string,
    parentId: string | null,
    afterSortKey?: string | null,
  ): Promise<Node | undefined>
  /** fs.delete 后端: 按 kind 删 (软删/取消关注/硬删)。 */
  fsDeleteNode(kind: NodeKind, id: string): Promise<void>
  /** fs.readBlob 后端: 文件二进制 base64 (大文件不内联, base64 空)。 */
  fsReadBlob(id: string): Promise<{ mime: string; size: number; base64: string } | undefined>
}

let port: FilesPort | null = null

/** core 在启动时注册其 FilesPort 实现。 */
export function registerFilesPort(p: FilesPort): void {
  port = p
}

/** 取「我的」数据端口 (插件用); 未注册 (BootGate 未挂载) 时抛错。 */
export function getFilesPort(): FilesPort {
  if (!port) throw new Error("FilesPort 未注册 (BootGate 未挂载?)")
  return port
}
