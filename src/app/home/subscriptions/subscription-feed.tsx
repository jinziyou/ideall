"use client"

import * as React from "react"
import Link from "next/link"
import { Rss, Search, Tag, Users, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { SUB_SPOKE_META } from "../lib/spoke-meta"
import { cn } from "@/components/lib/utils"
import { formatTimestamp } from "@/components/lib/format"
import { safeHref } from "@/components/lib/safe-url"
import { entityLabelText } from "@/components/lib/ner-labels"
import { resolveSubscription, type FeedItem } from "@protocol/content"
import { SUBSCRIPTIONS_SYNCED } from "@protocol/flowback"
import type { SubscriptionType } from "@protocol/subscription"
import type { Subscription } from "../model"
import { addSubscription, listSubscriptions, removeSubscription } from "../lib/subscriptions-store"
import { undoableToast } from "@/components/lib/undo-toast"

/** 每个订阅来源在订阅流里展示的最新条数。 */
const PER_SOURCE = 5
/** 搜索订阅本地过滤前先拉取的窗口大小 (服务端无关键词搜索, 故客户端在此窗口内按标题过滤)。 */
const SEARCH_WINDOW = 200

type SourceFeed = { sub: Subscription; items: FeedItem[]; error: boolean }
type Loaded = { tools: Subscription[]; feeds: SourceFeed[] }

/** 订阅来源对应的内链。 */
function sourceHref(sub: Subscription): string {
  if (sub.type === "publisher") return `/info/publisher?domain=${encodeURIComponent(sub.key)}`
  if (sub.type === "search") return "/info/search"
  if (sub.type === "peer") return "/community"
  return `/info/entity?label=${encodeURIComponent(sub.entityLabel ?? "")}&name=${encodeURIComponent(
    sub.entityName ?? "",
  )}`
}

/** 来源内容统一经 protocol 内容解析注册表拉取 (info/community 各自注册 resolver), 中枢不直接依赖 app。 */
const FEED_CTX = { perSource: PER_SOURCE, searchWindow: SEARCH_WINDOW }
async function loadFeed(sub: Subscription): Promise<SourceFeed> {
  const { items, error } = await resolveSubscription(sub, FEED_CTX)
  return { sub, items, error }
}

/**
 * 订阅流 —— 把 home 已订阅的来源汇聚到「我的」中枢:
 *   - 工具 (tool): 顶部「已钉工具」快捷启动区 (无内容流, 点开即跳)
 *   - 发布者 / 实体 / 搜索 / 社区发布者(peer): 各自最新条目卡片
 * 本地优先: 订阅偏好读自 IndexedDB; 内容实时从 wonita 服务拉取。
 */
export default function SubscriptionFeed({
  types,
  title = "订阅流",
  dotClass = "bg-spoke-info",
}: {
  /** 仅展示这些类型的订阅 (订阅=publisher/entity/search; 关注=peer)；缺省展示全部。 */
  types?: SubscriptionType[]
  title?: string
  dotClass?: string
} = {}) {
  const [state, setState] = React.useState<Loaded | null>(null)
  const [view, setView] = React.useState<"grid" | "list">("grid")
  // 退订进行中的项 (按 sub.id): 防重复触发, 并禁用对应的取消按钮
  const [pending, setPending] = React.useState<Set<string>>(new Set())
  const mountedRef = React.useRef(true)
  // 并发去重: 挂载 load 与同步事件 load 可能同时在飞, 仅最后发起的一次允许落 state, 防后写覆盖。
  const seqRef = React.useRef(0)

  const load = React.useCallback(async () => {
    const seq = ++seqRef.current
    const fresh = () => mountedRef.current && seq === seqRef.current
    let subs: Subscription[] = []
    try {
      subs = await listSubscriptions()
    } catch {
      if (fresh()) setState({ tools: [], feeds: [] })
      return
    }
    const visible = types ? subs.filter((s) => types.includes(s.type)) : subs
    const tools = visible.filter((s) => s.type === "tool")
    const sources = visible.filter((s) => s.type !== "tool")
    const feeds = await Promise.all(sources.map(loadFeed))
    if (fresh()) setState({ tools, feeds })
  }, [types])

  React.useEffect(() => {
    mountedRef.current = true
    load()
    // 跨端同步完成后刷新订阅流 (SyncPanel 广播)
    const onSynced = () => load()
    window.addEventListener(SUBSCRIPTIONS_SYNCED, onSynced)
    return () => {
      mountedRef.current = false
      window.removeEventListener(SUBSCRIPTIONS_SYNCED, onSynced)
    }
  }, [load])

  async function unsubscribe(sub: Subscription) {
    if (pending.has(sub.id)) return // 防重: 同一项退订进行中不再触发
    setPending((p) => new Set(p).add(sub.id))
    try {
      await removeSubscription(sub.type, sub.key)
      setState((prev) =>
        prev
          ? {
              tools: prev.tools.filter((t) => t.id !== sub.id),
              feeds: prev.feeds.filter((f) => f.sub.id !== sub.id),
            }
          : prev,
      )
      // 订阅是长期积累的资产, 误点可一键撤销 (addSubscription 复活墓碑: 清 deletedAt, 保留 createdAt)
      undoableToast(`已取消订阅 ${sub.title}`, async () => {
        await addSubscription(sub)
        await load()
      })
    } catch {
      toast.error("取消订阅失败，请重试")
    } finally {
      setPending((p) => {
        const next = new Set(p)
        next.delete(sub.id)
        return next
      })
    }
  }

  if (state === null) {
    return <p className="py-12 text-center text-sm text-muted-foreground">加载订阅中…</p>
  }

  const { tools, feeds } = state

  if (tools.length === 0 && feeds.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <Rss className="h-8 w-8 text-muted-foreground" />
        <p className="max-w-sm text-sm text-muted-foreground">
          还没有订阅。去「发现」订阅，内容会回流到这里。
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button asChild size="sm">
            <Link href="/info">浏览资讯</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/info/search">搜索</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/community">社区</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/tool">工具</Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {tools.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-spoke-tool" />
            已钉工具
          </h2>
          <div className="flex flex-wrap gap-2">
            {tools.map((t) => (
              <span
                key={t.id}
                className="group inline-flex items-center gap-1.5 rounded-full border bg-card py-1 pl-2.5 pr-1.5 text-sm text-card-foreground shadow-sm transition-colors hover:border-primary/40 hover:bg-accent"
              >
                <a
                  href={safeHref(t.key)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-w-0 items-center gap-1.5"
                >
                  {t.favicon ? (
                    // favicon 来自任意第三方域名, 用原生 img 避免为每个域名配置 next/image remotePatterns
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={t.favicon} alt="" className="h-4 w-4 shrink-0 rounded-sm" />
                  ) : null}
                  <span className="max-w-[12rem] truncate">{t.title}</span>
                </a>
                <button
                  type="button"
                  onClick={() => unsubscribe(t)}
                  disabled={pending.has(t.id)}
                  aria-label={`取消钉住 ${t.title}`}
                  // 触屏放大命中区到 ~40px (桌面保持紧凑)
                  className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50 pointer-coarse:p-2"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        </section>
      )}

      {feeds.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <h2 className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
              <span className={cn("h-1.5 w-1.5 rounded-full", dotClass)} />
              {title} · {feeds.length} 个来源
            </h2>
            <div className="ml-auto inline-flex items-center gap-1 rounded-lg border bg-card p-0.5">
              <button
                type="button"
                onClick={() => setView("grid")}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  view === "grid"
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                卡片
              </button>
              <button
                type="button"
                onClick={() => setView("list")}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  view === "list"
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                列表
              </button>
            </div>
          </div>
          <div
            className={cn(
              view === "grid" ? "grid gap-4 sm:grid-cols-2 xl:grid-cols-3" : "flex flex-col gap-3",
            )}
          >
            {feeds.map(({ sub, items, error }) => (
              <Card
                key={sub.id}
                className={cn("flex flex-col border-t-2", SUB_SPOKE_META[sub.type].topBorderClass)}
              >
                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
                  <Link
                    href={sourceHref(sub)}
                    className="flex min-w-0 items-center gap-2 hover:underline"
                  >
                    {sub.type === "publisher" ? (
                      sub.favicon ? (
                        // favicon 来自任意第三方域名, 用原生 img 避免为每个域名配置 next/image remotePatterns
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={sub.favicon} alt="" className="h-4 w-4 shrink-0 rounded-sm" />
                      ) : null
                    ) : sub.type === "search" ? (
                      <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : sub.type === "peer" ? (
                      <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <Tag className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <CardTitle className="truncate text-sm">{sub.title}</CardTitle>
                    {sub.type === "entity" && (
                      <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                        {entityLabelText(sub.entityLabel)}
                      </span>
                    )}
                    {sub.type === "search" && (
                      <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                        {sub.searchDomain ? sub.searchDomain : "搜索"}
                      </span>
                    )}
                    {sub.type === "peer" && (
                      <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                        社区
                      </span>
                    )}
                  </Link>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0"
                    onClick={() => unsubscribe(sub)}
                    disabled={pending.has(sub.id)}
                    title="取消订阅"
                  >
                    <X className="h-4 w-4" />
                    <span className="sr-only">取消订阅</span>
                  </Button>
                </CardHeader>
                <CardContent className="flex-1">
                  {error ? (
                    <p className="text-xs text-muted-foreground">内容加载失败</p>
                  ) : items.length === 0 ? (
                    <p className="text-xs text-muted-foreground">暂无最新内容</p>
                  ) : (
                    <ul className="space-y-2.5">
                      {items.map((it) => (
                        <li key={it.key} className="flex flex-col gap-0.5">
                          {/* it.url 来自他人 peer 发布 (跨用户内容), 必须过协议白名单防伪协议 XSS */}
                          {safeHref(it.url) ? (
                            <a
                              href={safeHref(it.url)}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="line-clamp-2 text-sm hover:underline"
                            >
                              {it.title}
                            </a>
                          ) : (
                            <span className="line-clamp-2 text-sm">{it.title}</span>
                          )}
                          {it.body ? (
                            <span className="line-clamp-2 text-xs text-muted-foreground">
                              {it.body}
                            </span>
                          ) : null}
                          <span className="text-xs text-muted-foreground">
                            {formatTimestamp(it.time)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
