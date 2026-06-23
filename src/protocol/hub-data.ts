// 中枢本地数据契约 —— core 拥有的本地优先实体 (资源 / 书签 / 收藏夹)。
// 这些类型既是 core 存储模型, 又经 HubDataPort 暴露给 plugin (如 agent), 故属契约。
// (订阅 Subscription 类型见 ./subscription)。
import type { Subscription, SubscriptionType, NewSubscription } from "./subscription"

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

/** 笔记本 (笔记分组), 类似书签收藏夹 */
export interface Notebook {
  id: string
  name: string
  createdAt: number
}

/**
 * 笔记正文 —— 类 Notion 块文档, 由块节点构成的数组 (Plate/Slate 值)。
 * JSON 可序列化, 直存 IndexedDB。protocol 不依赖编辑器实现 (platejs), 故以结构化 unknown[] 表达;
 * 编辑器封装层再断言为 Plate 的 Value。
 */
export type NoteContent = unknown[]

/** 笔记 (本地优先的原创块文档) */
export interface Note {
  id: string
  title: string
  /** 块文档正文 (Plate 值) */
  content: NoteContent
  /** 所属笔记本 id; null 表示未分组 */
  notebookId: string | null
  /** 用户标签 */
  tags: string[]
  createdAt: number
  /** 最后编辑时间戳, 毫秒 (列表按此倒序) */
  updatedAt: number
}

/** 笔记列表元数据 —— 不含完整 content, 改带纯文本摘要/全文, 避免列表整块载入正文 */
export type NoteMeta = Omit<Note, "content"> & {
  /** 正文前若干字符的纯文本, 用于列表卡片展示 */
  excerpt: string
  /** 正文全文纯文本 (不含格式), 用于全文搜索 */
  search: string
}

/** 新建笔记入参 (id/时间戳由实现补全; 均可选, content 缺省为空文档)。 */
export type NewNote = {
  title?: string
  content?: NoteContent
  notebookId?: string | null
  tags?: string[]
}

/**
 * 中枢本地数据端口 —— core 实现 (包装 IndexedDB stores), 经 protocol 暴露给 plugin。
 * agent 插件经此读写用户的订阅 / 书签 / 收藏夹 / 资源, 而非直接依赖 core 存储 (依赖反转)。
 */
export interface HubDataPort {
  // 订阅
  /** 列出活跃订阅 (过滤软删除墓碑)。UI / 插件读路径。 */
  listSubscriptions(): Promise<Subscription[]>
  /** 列出全部订阅含墓碑 —— 跨端同步合并用 (墓碑须进合并/上传才能传播删除)。 */
  listAllSubscriptions(): Promise<Subscription[]>
  addSubscription(input: NewSubscription): Promise<Subscription>
  removeSubscription(type: SubscriptionType, key: string): Promise<void>
  isSubscribed(type: SubscriptionType, key: string): Promise<boolean>
  /** 跨端同步落地: 写入合并 + GC 后的权威全集, 并物理清除集合外的过期墓碑 (一次事务批处理)。 */
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
  // 笔记 (读接口, 供插件读取中枢笔记)
  listNotes(): Promise<NoteMeta[]>
  getNote(id: string): Promise<Note | undefined>
}

let port: HubDataPort | null = null

/** core 在启动时注册其 HubDataPort 实现。 */
export function registerHubData(p: HubDataPort): void {
  port = p
}

/** 取中枢数据端口 (插件用); 未注册 (BootGate 未挂载) 时抛错。 */
export function getHubData(): HubDataPort {
  if (!port) throw new Error("HubDataPort 未注册 (BootGate 未挂载?)")
  return port
}
