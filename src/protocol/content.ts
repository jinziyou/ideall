// 订阅内容解析契约 —— 「我的」订阅流要为「任意订阅类型」渲染最新条目, 但不应直接依赖某个 app。
// 各 app 为自己拥有的订阅类型注册一个 resolver; 「我的」按 sub.type 派发 (依赖反转)。
import type { Subscription, SubscriptionType } from "./subscription"

/** 归一化的订阅流条目 (info 文章 / peer 发布共用一种渲染)。 */
export type FeedItem = { key: string; title: string; url?: string; body?: string; time: number }

/** 解析时的口径参数 (每源条数 / 搜索本地过滤窗口)。 */
export type ResolveCtx = { perSource: number; searchWindow: number }

/** 某订阅类型的内容解析器: 给一条订阅, 返回归一化条目 (失败置 error)。 */
export type ContentResolver = (
  sub: Subscription,
  ctx: ResolveCtx,
) => Promise<{ items: FeedItem[]; error: boolean }>

/** app manifest 里声明的「我负责解析这些类型」。 */
export type ResolverRegistration = { types: SubscriptionType[]; resolve: ContentResolver }

const resolvers = new Map<SubscriptionType, ContentResolver>()

/** 注册某些订阅类型的内容解析器 (组合根在启动时调用)。 */
export function registerContentResolver(types: SubscriptionType[], fn: ContentResolver): void {
  for (const t of types) {
    // 开发期对重复注册告警: 让 manifest 声明重叠 (同一类型被两个 app 认领) 尽早暴露, 而非静默覆盖。
    if (process.env.NODE_ENV !== "production" && resolvers.has(t)) {
      console.warn(
        `[content] 订阅类型 "${t}" 的解析器被重复注册并覆盖, 请检查各 manifest 的 types 是否重叠`,
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
    // 单个来源拉取异常不应拖垮整个订阅流
    return { items: [], error: true }
  }
}
