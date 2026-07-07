// community 模块 manifest —— 向「我的」注册「社区发布者 (peer)」关注的内容解析器。
// 「我的」关注流经此拉取某 peer 的最新发布, 不再直接依赖 peer 拉取细节。
import type { SubscriptionType } from "@protocol/subscription"
import type { ContentResolver, FeedItem, ResolverRegistration } from "@protocol/content"

const resolve: ContentResolver = async (sub, ctx) => {
  const { getPeerPublications } = await import("@protocol/peer")
  const res = await getPeerPublications(sub.key)
  if (!res.ok) return { items: [], error: true }
  const items: FeedItem[] = [...(res.data ?? [])]
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, ctx.perSource)
    .map((p) => ({
      key: String(p.id),
      title: p.title,
      url: p.url || undefined,
      body: p.body || undefined,
      time: p.created_at,
    }))
  return { items, error: false }
}

const types: SubscriptionType[] = ["peer"]

export const communityManifest = {
  id: "community" as const,
  resolvers: [{ types, resolve }] as ResolverRegistration[],
}
