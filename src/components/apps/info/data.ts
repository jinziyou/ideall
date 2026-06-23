// info 取数 facade —— 一律经 `@protocol/server-port` 的 ServerPort (官方实现为 HTTP 适配器)。
// 保留历史函数名/签名/返回口径, 调用点无需改动; wire DTO 与 wonita 服务细节收敛在适配器内。
import { getServerPort, type InfoQuery } from "@protocol/server-port"

/** 信息查询参数 (= ServerPort 的 InfoQuery)。 */
export type QueryParams = InfoQuery

/** 最新信息列表。 */
export function fetchLatestInfo(params: InfoQuery | Record<string, unknown>) {
  return getServerPort().queryInfo(params as InfoQuery)
}

/** 某条信息的「全面报道」(`/info/analysis`): 描述同一事件的其它来源。拿不到返回空数组。 */
export function getRelatedInfo(url: string) {
  return getServerPort().getRelatedInfo(url)
}

/** 实体详情聚合 (`GET /info/entity?label=&name=`)。拿不到返回 null。 */
export function getEntityDetail(label: string, name: string) {
  return getServerPort().getEntityDetail(label, name)
}

/** 单条信息详情; 拿不到返回 null。 */
export function getInfo(url: string) {
  return getServerPort().getInfo(url)
}
