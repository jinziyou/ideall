import { Info, InfoEvent, Publisher } from "./model"

/**
 * /info 首页三种视图的纯派生函数 —— 共用一次 `POST /info/events` 取数:
 * 事件聚类 (并查集) 本就无损覆盖同页全部信息, 摊平即「最新」列表,
 * 再按发布者分组即「发布者」视图, 切换视图零额外请求。
 */

/** 热度衰减半衰期: 24h。成员每老一天, 对簇热度的贡献减半 —— 密集且新近的簇排前。 */
const TREND_HALF_LIFE_MS = 24 * 60 * 60 * 1000

/** 单条信息的新近度权重 (0,1]: 按采集时间衰减; 不用源站 publish_time —— 它可能缺失 (epoch 0 哨兵) 或不可信。 */
function recencyWeight(info: Info, now: number): number {
  const t = info.collect_time
  if (!t || t <= 0) return 0
  const age = Math.max(0, now - t)
  return Math.pow(0.5, age / TREND_HALF_LIFE_MS)
}

/** 簇热度 = 全体成员新近度权重之和: 同时奖励密集 (成员多) 与新近 (成员新)。 */
function trendScore(event: InfoEvent, now: number): number {
  return [event.lead, ...event.related].reduce((sum, m) => sum + recencyWeight(m, now), 0)
}

/** 热点视图: 事件簇按时间趋势加权密度倒序 (服务端仅按 lead 采集时间倒序, 不含密度)。 */
export function rankEventsByTrend(events: InfoEvent[]): InfoEvent[] {
  const now = Date.now()
  return events
    .map((event) => ({ event, score: trendScore(event, now) }))
    .sort((a, b) => b.score - a.score || b.event.lead.collect_time - a.event.lead.collect_time)
    .map(({ event }) => event)
}

/** 最新视图: 摊平事件簇还原为单条信息列表, 按采集时间倒序。 */
export function flattenEvents(events: InfoEvent[]): Info[] {
  return events
    .flatMap((event) => [event.lead, ...event.related])
    .sort((a, b) => b.collect_time - a.collect_time)
}

/** 发布者视图的行: 一行一个发布者, 携带其本页信息。 */
export type PublisherGroup = {
  publisher: Publisher
  /** 该发布者最新一条 (按采集时间)。 */
  latest: Info
  /** 近期 (本页取数窗口内) 该发布者的信息条数。 */
  count: number
  /** 近期该发布者的全部信息, 采集时间倒序 (含 latest)。 */
  items: Info[]
}

/** 发布者视图: 按域名分组, 组间按最新一条的采集时间倒序; 无域名的信息无法订阅/钻取, 不入组。 */
export function groupByPublisher(infos: Info[]): PublisherGroup[] {
  const byDomain = new Map<string, Info[]>()
  for (const info of infos) {
    const domain = info.publisher?.domain
    if (!domain) continue
    const list = byDomain.get(domain)
    if (list) list.push(info)
    else byDomain.set(domain, [info])
  }
  return [...byDomain.values()]
    .map((items) => {
      const sorted = [...items].sort((a, b) => b.collect_time - a.collect_time)
      return {
        publisher: sorted[0].publisher,
        latest: sorted[0],
        count: sorted.length,
        items: sorted,
      }
    })
    .sort((a, b) => b.latest.collect_time - a.latest.collect_time)
}
