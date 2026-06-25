"use client"

// 节点查看器: 订阅 (feed)。自取数 (getSubscription) + 经协议内容解析 (resolveSubscription) 拉取单源最新条目。
// tool 类订阅无内容流, 改为「打开工具」启动入口。条目外链经 safeHref 协议白名单 (防伪协议 XSS)。
import * as React from "react"
import { ExternalLink, Loader2, Rss } from "lucide-react"
import { Button } from "@/ui/button"
import { formatTimestamp } from "@/lib/format"
import { safeHref, openExternal } from "@/lib/safe-url"
import { resolveSubscription, type FeedItem } from "@protocol/content"
import type { SubscriptionType } from "@protocol/subscription"
import type { Subscription } from "@/modules/home/model"
import { getSubscription } from "@/files/stores/subscriptions-store"
import { renameNodeTab } from "../store"
import type { NodeViewerProps } from "../node-viewers"

const CTX = { perSource: 20, searchWindow: 200 }

const TYPE_LABEL: Record<SubscriptionType, string> = {
  publisher: "发布者",
  entity: "实体",
  search: "搜索",
  peer: "社区发布者",
  tool: "工具",
}

export default function FeedViewer({ nodeId }: NodeViewerProps) {
  const [sub, setSub] = React.useState<Subscription | null>(null)
  const [items, setItems] = React.useState<FeedItem[] | null>(null)
  const [error, setError] = React.useState(false)
  const [missing, setMissing] = React.useState(false)

  React.useEffect(() => {
    let alive = true
    getSubscription(nodeId)
      .then(async (s) => {
        if (!alive) return
        if (!s) {
          setMissing(true)
          return
        }
        setSub(s)
        renameNodeTab({ kind: "feed", id: nodeId }, s.title || s.key || "订阅")
        if (s.type === "tool") {
          setItems([]) // 工具无内容流 (下方改为启动入口)
          return
        }
        try {
          const r = await resolveSubscription(s, CTX)
          if (!alive) return
          setItems(r.items)
          setError(r.error)
        } catch {
          if (alive) {
            setItems([])
            setError(true)
          }
        }
      })
      .catch(() => {
        if (alive) setMissing(true)
      })
    return () => {
      alive = false
    }
  }, [nodeId])

  if (missing) {
    return <div className="p-6 text-sm text-muted-foreground">该订阅不存在或已取消。</div>
  }
  if (!sub) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
      <div className="flex items-center gap-3">
        {sub.favicon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={sub.favicon} alt="" className="h-8 w-8 shrink-0 rounded" />
        ) : (
          <Rss className="h-8 w-8 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold" title={sub.title}>
            {sub.title || sub.key}
          </h1>
          <div className="truncate text-xs text-muted-foreground">{TYPE_LABEL[sub.type]}</div>
        </div>
      </div>

      {sub.type === "tool" ? (
        <div>
          <Button variant="outline" onClick={() => openExternal(sub.key)}>
            <ExternalLink className="mr-2 h-4 w-4" />
            打开工具
          </Button>
        </div>
      ) : items === null ? (
        <div className="flex justify-center py-8 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : error ? (
        <p className="text-sm text-muted-foreground">内容加载失败。</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无最新内容。</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((it) => (
            <li key={it.key} className="flex flex-col gap-0.5 border-b pb-3 last:border-0">
              {/* it.url 来自他人 peer 发布 (跨用户内容), 必须过协议白名单防伪协议 XSS */}
              {safeHref(it.url) ? (
                <a
                  href={safeHref(it.url)}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-sm font-medium hover:underline"
                >
                  {it.title}
                </a>
              ) : (
                <span className="text-sm font-medium">{it.title}</span>
              )}
              {it.body && (
                <span className="line-clamp-2 text-xs text-muted-foreground">{it.body}</span>
              )}
              <span className="text-xs text-muted-foreground">{formatTimestamp(it.time)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
