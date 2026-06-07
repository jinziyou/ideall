"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowUpRight, Hexagon, Map, Newspaper, Wrench } from "lucide-react"
import { cn } from "@/lib/utils"
import { listSubscriptions } from "./lib/subscriptions-store"
import { listBookmarks } from "./lib/bookmarks-store"
import { listFiles } from "./lib/files-store"
import { countAgentThreads } from "./lib/agent-threads-count"
import { HUB_UPDATED } from "./lib/flowback"
import type { Subscription } from "./model"
import { HubStatTiles } from "./hub-stat-tiles"
import { RecentFlowback, type FlowItem } from "./recent-flowback"

type HubData = {
  subs: Subscription[]
  bookmarks: number
  files: number
  threads: number
  flow: FlowItem[]
  pinnedTools: Subscription[]
  usage: number
  quota: number
}

/** 订阅类型 → 时间线展示元数据 (圆点色 + 动作文案)。 */
const SUB_META: Record<Subscription["type"], { dotClass: string; label: string }> = {
  publisher: { dotClass: "bg-spoke-info", label: "订阅发布者" },
  entity: { dotClass: "bg-spoke-info", label: "订阅实体" },
  search: { dotClass: "bg-spoke-info", label: "订阅搜索" },
  peer: { dotClass: "bg-spoke-community", label: "订阅 peer" },
  tool: { dotClass: "bg-spoke-tool", label: "钉住工具" },
}

function buildFlow(subs: Subscription[], bookmarks: { id: string; title: string; createdAt: number }[], files: { id: string; name: string; createdAt: number }[]): FlowItem[] {
  const items: FlowItem[] = []
  for (const s of subs) {
    const m = SUB_META[s.type]
    items.push({ id: `sub:${s.id}`, ts: s.createdAt, dotClass: m.dotClass, label: m.label, title: s.title, href: "/home/subscriptions" })
  }
  for (const b of bookmarks) {
    items.push({ id: `bm:${b.id}`, ts: b.createdAt, dotClass: "bg-pop", label: "收藏书签", title: b.title, href: "/home/bookmarks" })
  }
  for (const f of files) {
    items.push({ id: `f:${f.id}`, ts: f.createdAt, dotClass: "bg-pop", label: "添加资源", title: f.name, href: "/home/resources" })
  }
  return items.sort((a, b) => b.ts - a.ts).slice(0, 14)
}

const SPOKES = [
  { href: "/info", label: "资讯", dot: "bg-spoke-info", icon: Newspaper, hint: "订阅发布者 / 实体 · 收藏文章" },
  { href: "/community", label: "社区", dot: "bg-spoke-community", icon: Map, hint: "订阅 peer · 接收他人发布" },
  { href: "/tool", label: "工具", dot: "bg-spoke-tool", icon: Wrench, hint: "钉工具 · 存搜索为订阅" },
] as const

export default function HubDashboard() {
  const [data, setData] = React.useState<HubData | null>(null)

  React.useEffect(() => {
    let alive = true
    async function load() {
      // 每个 store 各自兜底: 单个仓库失败不应把整个中枢清空成「空态」(否则有数据的用户会误见 onboarding)
      const [subs, bookmarks, files, threadCount] = await Promise.all([
        listSubscriptions().catch(() => [] as Subscription[]),
        listBookmarks().catch(() => []),
        listFiles().catch(() => []),
        countAgentThreads().catch(() => 0),
      ])
      let usage = 0
      let quota = 0
      try {
        const est = await navigator.storage?.estimate?.()
        if (est) {
          usage = est.usage ?? 0
          quota = est.quota ?? 0
        }
      } catch {
        /* StorageManager 不可用时省略用量 */
      }
      if (!alive) return
      setData({
        subs,
        bookmarks: bookmarks.length,
        files: files.length,
        threads: threadCount,
        flow: buildFlow(subs, bookmarks, files),
        pinnedTools: subs.filter((s) => s.type === "tool"),
        usage,
        quota,
      })
    }
    load()
    // 同会话内任意回流 / 跨端同步后刷新仪表盘 (与头部计数同源)
    const onUpdate = () => load()
    window.addEventListener(HUB_UPDATED, onUpdate)
    window.addEventListener("wonita:subscriptions-synced", onUpdate)
    return () => {
      alive = false
      window.removeEventListener(HUB_UPDATED, onUpdate)
      window.removeEventListener("wonita:subscriptions-synced", onUpdate)
    }
  }, [])

  if (!data) {
    return (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-[78px] animate-pulse rounded-xl border bg-muted/40" />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-xl border bg-muted/40" />
      </div>
    )
  }

  const isEmpty = data.subs.length === 0 && data.bookmarks === 0 && data.files === 0 && data.threads === 0

  if (isEmpty) return <EmptyHub />

  return (
    <div className="flex flex-col gap-6">
      <HubStatTiles
        subs={data.subs.length - data.pinnedTools.length}
        bookmarks={data.bookmarks}
        files={data.files}
        threads={data.threads}
        usage={data.usage}
        quota={data.quota}
      />

      <div className="grid gap-5 lg:grid-cols-3">
        {/* 最近回流 (脊柱) */}
        <div className="rounded-xl border-l-2 border-l-pop border bg-card p-5 shadow-sm lg:col-span-2">
          <div className="mb-4 flex items-center gap-2">
            <h2 className="text-sm font-semibold">最近回流</h2>
            <span className="text-xs text-muted-foreground">· 本地 · 收入中枢的动作落点</span>
          </div>
          {data.flow.length > 0 ? (
            <RecentFlowback items={data.flow} />
          ) : (
            <p className="text-sm text-muted-foreground">还没有回流记录 —— 去「发现」订阅或收藏点什么。</p>
          )}
        </div>

        {/* 去发现, 带东西回家 */}
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <h2 className="mb-1 text-sm font-semibold">去发现，带东西回家</h2>
          <p className="mb-4 text-xs text-muted-foreground">资讯 · 社区 · 工具，都把东西回流进这个中枢</p>
          <div className="flex flex-col gap-2.5">
            {SPOKES.map((s) => (
              <Link
                key={s.href}
                href={s.href}
                className="group flex items-start gap-3 rounded-lg border bg-background p-3 transition-colors hover:border-foreground/20 hover:bg-accent"
              >
                <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", s.dot)} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <s.icon className="h-3.5 w-3.5" />
                    {s.label}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{s.hint}</span>
                </span>
                <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* 已钉工具 */}
      {data.pinnedTools.length > 0 && (
        <div>
          <div className="mb-2.5 text-xs text-muted-foreground">⌘ 已钉工具</div>
          <div className="flex flex-wrap gap-2.5">
            {data.pinnedTools.map((t) => (
              <a
                key={t.id}
                href={t.key}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm shadow-sm transition-colors hover:bg-accent"
              >
                <span className="grid h-5 w-5 place-items-center rounded bg-muted text-muted-foreground">
                  <Wrench className="h-3 w-3" />
                </span>
                <span className="max-w-[12rem] truncate">{t.title}</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** 空中枢: 把死屏变成产品心智模型的第一课 (hub-and-spoke 迷你示意图)。 */
function EmptyHub() {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed bg-card/50 px-6 py-12 text-center">
      <h3 className="text-base font-semibold">◆ 我的空间还是空的 —— 去带点东西回家</h3>
      <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
        你订阅 / 收藏 / 钉住的一切都会落在这里, 且只留在这台设备。
      </p>

      <div className="mt-8 flex flex-col items-center gap-1">
        <div className="inline-flex flex-col items-center rounded-xl border-2 border-foreground/15 bg-pop/5 px-6 py-3">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Hexagon className="h-4 w-4" />
            我的空间
          </span>
          <span className="text-xs text-muted-foreground">数据落在这里，本地恒在</span>
        </div>
        <div className="my-1 text-muted-foreground">↑</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {SPOKES.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="flex flex-col items-center gap-1 rounded-xl border bg-background px-5 py-3 text-center transition-colors hover:bg-accent"
            >
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                <span className={cn("h-2 w-2 rounded-full", s.dot)} />
                {s.label}
              </span>
              <span className="text-xs font-medium text-pop">去这里带东西回家 →</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
