// 关注内容解析接口约定 —— 「我的」关注流要为「任意关注类型」渲染最新条目, 但不应直接依赖某个 app。
// 各 app 为自己拥有的关注类型注册一个 resolver; 「我的」按 sub.type 派发 (依赖反转)。
import type { Subscription, SubscriptionType } from "./subscription"

/** 规范化的关注流条目 (info 文章 / peer 发布共用一种渲染)。 */
export type FeedItem = { key: string; title: string; url?: string; body?: string; time: number }

/** 解析时的口径参数 (每源条数 / 搜索本地过滤窗口)。 */
export type ResolveCtx = { perSource: number; searchWindow: number }

/** 某关注类型的内容解析器: 给一条关注, 返回规范化条目 (失败置 error)。 */
export type ContentResolver = (
  sub: Subscription,
  ctx: ResolveCtx,
) => Promise<{ items: FeedItem[]; error: boolean }>

/** app manifest 里声明的「我负责解析这些类型」。 */
export type ResolverRegistration = { types: SubscriptionType[]; resolve: ContentResolver }

const resolvers = new Map<SubscriptionType, ContentResolver>()

/** 注册某些关注类型的内容解析器 (组合根在启动时调用)。 */
export function registerContentResolver(types: SubscriptionType[], fn: ContentResolver): void {
  for (const t of types) {
    const prev = resolvers.get(t)
    if (prev === fn) continue // HMR / StrictMode 重复 registerAll: 同函数幂等跳过
    if (process.env.NODE_ENV !== "production" && prev) {
      console.warn(
        `[content] 关注类型 "${t}" 的解析器被重复注册并覆盖, 请检查各 manifest 的 types 是否重叠`,
      )
    }
    resolvers.set(t, fn)
  }
}

/** 按 sub.type 派发到已注册的 resolver; 未注册类型 → 空结果 (如 tool, 无内容流)。 */
export async function resolveSubscription(
  sub: Subscription,
  ctx: ResolveCtx,
): Promise<{ items: FeedItem[]; error: boolean }> {
  const fn = resolvers.get(sub.type)
  if (!fn) return { items: [], error: false }
  try {
    return await fn(sub, ctx)
  } catch {
    // 单个来源拉取异常不应拖垮整个关注流
    return { items: [], error: true }
  }
}
