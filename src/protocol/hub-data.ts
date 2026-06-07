// 中枢本地数据契约 —— core 拥有的本地优先实体 (资源 / 书签 / 收藏夹)。
// 这些类型既是 core 存储模型, 又经 HubDataPort 暴露给 plugin (如 agent), 故属契约。
// (订阅 Subscription 类型见 ./subscription)。

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
