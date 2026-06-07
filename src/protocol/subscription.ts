// 订阅契约 —— 跨 app/core/plugin 的「发现来源订阅」类型与去重键约定。
// app 产生订阅 (NewSubscription)，core 落地存储，plugin/core 读取。

export type SubscriptionType = "publisher" | "entity" | "tool" | "search" | "peer"

/**
 * 「发现」订阅 —— home 中枢从 info / community / tool 订阅的来源。
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
  /** 最后更新时间 (跨端 LWW 合并用; 缺省视为 createdAt, 兼容无此字段的存量数据)。 */
  updatedAt?: number
}

/** app 提交给中枢的「新订阅」入参 (id/favicon/createdAt 由 core 补全)。 */
export type NewSubscription = {
  type: SubscriptionType
  key: string
  title: string
  favicon?: string
  /** 实体订阅专用 */
  entityLabel?: string
  entityName?: string
  /** 搜索订阅专用 */
  searchKeyword?: string
  searchDomain?: string
}
