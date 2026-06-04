// Home 模块域类型 —— 个人资源与信息管理中心 (本地优先, 数据存于浏览器 IndexedDB)

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

/** 「发现」订阅类型: 发布者 / 实体 / 工具 / 搜索 / 社区发布者(peer)。 */
export type SubscriptionType = "publisher" | "entity" | "tool" | "search" | "peer"

/**
 * 「发现」订阅 —— home 从 info / community / tool 订阅的来源。
 * 本地优先: 仅订阅偏好存于 IndexedDB, 内容 (如最新文章) 实时从 super 拉取。
 */
export interface Subscription {
  id: string
  type: SubscriptionType
  /** 去重键: 同类型下唯一 (发布者用 domain; 实体用 `label/name`; 工具用启动 URL) */
  key: string
  /** 展示名 */
  title: string
  /** 站点图标 URL (实体订阅可为空) */
  favicon: string
  /** 实体订阅专用: NER label (PER/ORG/LOC/…) 与 name, 用于查询匹配文章 */
  entityLabel?: string
  entityName?: string
  /** 搜索订阅专用: 标题关键词 + 可选发布者域名 (本地优先, 客户端按标题子串过滤) */
  searchKeyword?: string
  searchDomain?: string
  createdAt: number
}
