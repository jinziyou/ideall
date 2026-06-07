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

/**
 * 中枢本地数据端口 —— core 实现 (包装 IndexedDB stores), 经 protocol 暴露给 plugin。
 * agent 插件经此读写用户的订阅 / 书签 / 收藏夹 / 资源, 而非直接依赖 core 存储 (依赖反转)。
 */
export interface HubDataPort {
  // 订阅
  listSubscriptions(): Promise<Subscription[]>
  addSubscription(input: NewSubscription): Promise<Subscription>
  removeSubscription(type: SubscriptionType, key: string): Promise<void>
  isSubscribed(type: SubscriptionType, key: string): Promise<boolean>
  /** 批量写入 (跨端同步合并后整批落本地, 一次事务)。 */
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
