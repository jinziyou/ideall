// 关注接口约定 —— 跨 app/core/plugin 的「发现来源关注」类型与去重键约定。
// app 产生关注 (NewSubscription)，core 落地存储，plugin/core 读取。

export const SUBSCRIPTION_TYPES = ["publisher", "entity", "tool", "search", "peer"] as const

export type SubscriptionType = (typeof SUBSCRIPTION_TYPES)[number]

export function isSubscriptionType(value: unknown): value is SubscriptionType {
  return typeof value === "string" && (SUBSCRIPTION_TYPES as readonly string[]).includes(value)
}

/** 同步 wire 主键必须与 type/key 一一对应，避免同一关注被伪造 id 分裂成多条记录。 */
export function hasCanonicalSubscriptionIdentity(value: {
  id: string
  type: SubscriptionType
  key: string
}): boolean {
  return (
    value.key.length > 0 &&
    value.key.trim() === value.key &&
    value.id === `${value.type}:${value.key}`
  )
}

/** 可选元数据在解密/存储边界也需保持 wire 类型，避免脏值进入统一节点。 */
export function hasValidSubscriptionMetadata(value: {
  entityLabel?: unknown
  entityName?: unknown
  searchKeyword?: unknown
  searchDomain?: unknown
}): boolean {
  return [value.entityLabel, value.entityName, value.searchKeyword, value.searchDomain].every(
    (field) => field === undefined || typeof field === "string",
  )
}

/**
 * 「发现」关注 —— home「我的」从 info / community / tool 关注的来源。
 * 本地优先: 仅关注偏好存于 IndexedDB, 内容 (如最新文章) 实时经 ServerPort (默认 wonita 服务) 拉取。
 */
export interface Subscription {
  id: string
  type: SubscriptionType
  /** 去重键: 同类型下唯一 (发布者用 domain; 实体用 `label/name`; 工具用启动 URL) */
  key: string
  /** 展示名 */
  title: string
  /** 站点图标 URL (实体关注可为空) */
  favicon: string
  /** 实体关注专用: NER label (PER/ORG/LOC/…) 与 name, 用于查询匹配文章 */
  entityLabel?: string
  entityName?: string
  /** 搜索关注专用: 标题关键词 + 可选发布者域名 (本地优先, 客户端按标题子串过滤) */
  searchKeyword?: string
  searchDomain?: string
  createdAt: number
  /** 最后更新时间 (跨端 LWW 合并用)。 */
  updatedAt: number
  /**
   * 软删除标记 (tombstone) 时间戳 epoch 毫秒; 缺省 = 活跃关注。
   * 跨端同步用: 删除写删除标记而非物理删, 让「删除」按 LWW 跨端收敛 (否则另一端会把已删项带回 = 恢复)。
   * 读路径 (listSubscriptions/isSubscribed) 过滤删除标记; 过保留期后 GC 物理清除 (见 @protocol/sync)。
   */
  deletedAt?: number
}

/** app 提交给「我的」的「新关注」入参 (id/favicon/createdAt 由 core 补全)。 */
export type NewSubscription = {
  type: SubscriptionType
  key: string
  title: string
  favicon?: string
  /** 实体关注专用 */
  entityLabel?: string
  entityName?: string
  /** 搜索关注专用 */
  searchKeyword?: string
  searchDomain?: string
}
