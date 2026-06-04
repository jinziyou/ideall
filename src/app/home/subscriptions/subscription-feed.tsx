"use client"

import * as React from "react"
import Link from "next/link"
import { Rss, Search, Tag, Users, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatTimestamp } from "@/lib/format"
import { fetchLatestInfo } from "@/app/(discover)/info/action"
import { getPeerPublications } from "@/lib/peer-action"
import type { Subscription } from "../model"
import { listSubscriptions, removeSubscription } from "../lib/subscriptions-store"

/** 每个订阅来源在订阅流里展示的最新条数。 */
const PER_SOURCE = 5
/** 搜索订阅本地过滤前先拉取的窗口大小 (服务端无关键词搜索, 故客户端在此窗口内按标题过滤)。 */
const SEARCH_WINDOW = 200

/** 归一化的订阅流条目 (info 文章 / peer 发布共用一种渲染)。 */
type FeedItem = { key: string; title: string; url?: string; body?: string; time: number }
type SourceFeed = { sub: Subscription; items: FeedItem[]; error: boolean }
type Loaded = { tools: Subscription[]; feeds: SourceFeed[] }

/** NER label → 中文 (与 info EntityCell 口径一致); 未知则原样。 */
function entityLabelText(label: string | undefined): string {
  switch (label) {
    case "PER":
      return "人物"
    case "ORG":
      return "组织"
    case "LOC":
      return "地区"
    default:
      return label ?? "实体"
  }
}

/** info 支撑的来源 (发布者/实体/搜索) 拉取最新文章 (复用 info 的 fetchLatestInfo)。 */
async function fetchInfoSource(sub: Subscription) {
  if (sub.type === "publisher") {
    return fetchLatestInfo({ publisher_domain: sub.key, page_size_offset: [PER_SOURCE, 0] })
  }
  if (sub.type === "search") {
    // 本地优先: 服务端无关键词搜索, 拉一个较大窗口, 客户端按标题子串过滤 (见 load)
    const params: Record<string, unknown> = { page_size_offset: [SEARCH_WINDOW, 0] }
    if (sub.searchDomain) params.publisher_domain = sub.searchDomain
    return fetchLatestInfo(params)
  }
  return fetchLatestInfo({
    entity_label_name: [[sub.entityLabel ?? "", sub.entityName ?? ""]],
    page_size_offset: [PER_SOURCE, 0],
  })
}

/** 订阅来源对应的内链。 */
function sourceHref(sub: Subscription): string {
  if (sub.type === "publisher") return `/info/publisher/${encodeURIComponent(sub.key)}`
  if (sub.type === "search") return "/info/search"
  if (sub.type === "peer") return "/community"
  return `/info/entity/${encodeURIComponent(sub.entityLabel ?? "")}/${encodeURIComponent(
    sub.entityName ?? "",
  )}`
}

/** 拉取并归一化某订阅来源的条目。 */
async function loadFeed(sub: Subscription): Promise<SourceFeed> {
  try {
    if (sub.type === "peer") {
      const res = await getPeerPublications(sub.key)
      if (!res.ok) return { sub, items: [], error: true }
      const items = [...res.data]
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, PER_SOURCE)
        .map((p): FeedItem => ({
          key: String(p.id),
          title: p.title,
          url: p.url || undefined,
          body: p.body || undefined,
          time: p.created_at,
        }))
      return { sub, items, error: false }
    }
    const res = await fetchInfoSource(sub)
    if (!res.ok) return { sub, items: [], error: true }
    let rows = res.data
    if (sub.type === "search") {
      const kw = (sub.searchKeyword ?? "").toLowerCase()
      rows = rows.filter((i) => (i.title ?? "").toLowerCase().includes(kw))
    }
    const items = [...rows]
      .sort((a, b) => b.collect_time - a.collect_time)
      .slice(0, PER_SOURCE)
      .map((i): FeedItem => ({ key: i.url, title: i.title || i.url, url: i.url, time: i.collect_time }))
    return { sub, items, error: false }
  } catch {
    // 单个来源拉取异常不应拖垮整个订阅流
    return { sub, items: [], error: true }
  }
}

/**
 * 订阅流 —— 把 home 已订阅的来源汇聚到「我的空间」中枢:
 *   - 工具 (tool): 顶部「已钉工具」快捷启动区 (无内容流, 点开即跳)
 *   - 发布者 / 实体 / 搜索 / 社区发布者(peer): 各自最新条目卡片
 * 本地优先: 订阅偏好读自 IndexedDB; 内容实时从 super 拉取。
 */
export default function SubscriptionFeed() {
  const [state, setState] = React.useState<Loaded | null>(null)
  const mountedRef = React.useRef(true)

  const load = React.useCallback(async () => {
    let subs: Subscription[] = []
    try {
      subs = await listSubscriptions()
    } catch {
      if (mountedRef.current) setState({ tools: [], feeds: [] })
      return
    }
    const tools = subs.filter((s) => s.type === "tool")
    const sources = subs.filter((s) => s.type !== "tool")
    const feeds = await Promise.all(sources.map(loadFeed))
    if (mountedRef.current) setState({ tools, feeds })
  }, [])

  React.useEffect(() => {
    mountedRef.current = true
    load()
    // 跨端同步完成后刷新订阅流 (SyncPanel 广播)
    const onSynced = () => load()
    window.addEventListener("wonita:subscriptions-synced", onSynced)
    return () => {
      mountedRef.current = false
      window.removeEventListener("wonita:subscriptions-synced", onSynced)
    }
  }, [load])

  async function unsubscribe(sub: Subscription) {
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
      toast.success(`已取消订阅 ${sub.title}`)
    } catch {
      toast.error("取消订阅失败, 请重试")
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
          还没有订阅。去「发现」订阅发布者 / 实体 / 保存搜索 / 社区发布者, 或把常用工具钉到 home, 都会汇聚到这里。
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
          <h2 className="text-sm font-medium text-muted-foreground">已钉工具</h2>
          <div className="flex flex-wrap gap-2">
            {tools.map((t) => (
              <span
                key={t.id}
                className="group inline-flex items-center gap-1.5 rounded-full border bg-card py-1 pl-2.5 pr-1.5 text-sm text-card-foreground shadow-sm transition-colors hover:border-primary/40 hover:bg-accent"
              >
                <a
                  href={t.key}
                  target="_blank"
                  rel="noreferrer"
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
                  aria-label={`取消钉住 ${t.title}`}
                  className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        </section>
      )}

      {feeds.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {feeds.map(({ sub, items, error }) => (
            <Card key={sub.id} className="flex flex-col">
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
                        {it.url ? (
                          <a
                            href={it.url}
                            target="_blank"
                            rel="noreferrer"
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
      )}
    </div>
  )
}
