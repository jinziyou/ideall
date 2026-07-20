// info 模块 manifest —— 向「我的」注册「发布者 / 实体 / 搜索」三类关注的内容解析器。
// 「我的」关注流经此拉取最新文章, 不再直接 import info 的 data 模块 (依赖反转)。
import type { Subscription, SubscriptionType } from "@protocol/subscription"
import type { ContentResolver, FeedItem, ResolveCtx, ResolverRegistration } from "@protocol/content"

/** 发布者/实体/搜索三类来源拉取最新文章 (搜索拉较大窗口, 客户端按标题过滤)。 */
async function fetchInfoSource(sub: Subscription, ctx: ResolveCtx) {
  const { fetchLatestInfo } = await import("./data")
  if (sub.type === "publisher") {
    return fetchLatestInfo({ publisher_domain: sub.key, page_size_offset: [ctx.perSource, 0] })
  }
  if (sub.type === "search") {
    // 本地优先: 服务端无关键词搜索, 拉一个较大窗口, 客户端按标题子串过滤。
    const params: Record<string, unknown> = { page_size_offset: [ctx.searchWindow, 0] }
    if (sub.searchDomain) params.publisher_domain = sub.searchDomain
    return fetchLatestInfo(params)
  }
  return fetchLatestInfo({
    entity_label_name: [[sub.entityLabel ?? "", sub.entityName ?? ""]],
    page_size_offset: [ctx.perSource, 0],
  })
}

const resolve: ContentResolver = async (sub, ctx) => {
  const res = await fetchInfoSource(sub, ctx)
  if (!res.ok) return { items: [], error: true }
  let rows = res.data ?? []
  if (sub.type === "search") {
    const kw = (sub.searchKeyword ?? "").toLowerCase()
    rows = rows.filter((i) => (i.title ?? "").toLowerCase().includes(kw))
  }
  const items: FeedItem[] = [...rows]
    .sort((a, b) => b.collect_time - a.collect_time)
    .slice(0, ctx.perSource)
    .map((i) => ({ key: i.url, title: i.title || i.url, url: i.url, time: i.collect_time }))
  return { items, error: false }
}

const types: SubscriptionType[] = ["publisher", "entity", "search"]

export const infoManifest = {
  id: "info" as const,
  resolvers: [{ types, resolve }] as ResolverRegistration[],
}
