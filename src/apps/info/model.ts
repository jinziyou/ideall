// Info / InfoEvent / NameEntity / Publisher 类型直接派生自 super/server 的 OpenAPI schema
// (src/lib/api/server.d.ts)。改了 server 端模型, 重跑 `pnpm sync:api && pnpm gen:api` 即可同步。

import type { components } from "@protocol/server"

export type Info = components["schemas"]["Info"]
export type InfoEvent = components["schemas"]["InfoEvent"]
export type NameEntity = components["schemas"]["NameEntity"]
export type Publisher = components["schemas"]["Publisher"]
/** `/info/analysis` 响应项: Info 字段平铺 + shared/shared_entry 关联强度 (旧 Info 消费方向后兼容)。 */
export type RelatedInfo = components["schemas"]["RelatedInfo"]
/** `/info/entity?label=&name=` 实体详情聚合 (跨周合并; 不存在时 mention_count=0)。 */
export type EntityDetail = components["schemas"]["EntityDetail"]
/** 实体摘要 (实体搜索结果项 / 详情共现实体项)。 */
export type EntityBrief = components["schemas"]["EntityBrief"]
/** `/info/entity/{hour}` 近 N 小时五类实体频次 (每类 top20 的 `{name: count}`)。 */
export type EntityStats = components["schemas"]["EntityStats"]
