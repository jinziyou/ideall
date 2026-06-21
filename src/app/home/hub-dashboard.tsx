"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowUpRight, CornerDownLeft, Hexagon, Pin, Sparkles, Wrench } from "lucide-react"
import { cn } from "@/components/lib/utils"
import { SUB_SPOKE_META } from "./lib/spoke-meta"
import { SPOKES } from "@/app/nav/nav-config"
import { listSubscriptions } from "./lib/subscriptions-store"
import { listBookmarks } from "./lib/bookmarks-store"
import { listFiles } from "./lib/files-store"
import { countAgentThreads } from "./lib/agent-threads-count"
import { onHubUpdated } from "@protocol/flowback"
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
}

function buildFlow(
  subs: Subscription[],
  bookmarks: { id: string; title: string; createdAt: number }[],
  files: { id: string; name: string; createdAt: number }[],
): FlowItem[] {
  const items: FlowItem[] = []
  for (const s of subs) {
    const m = SUB_SPOKE_META[s.type]
    items.push({
      id: `sub:${s.id}`,
      ts: s.createdAt,
      dotClass: m.dotClass,
      label: m.actionLabel,
      title: s.title,
      href: "/home/subscriptions",
    })
  }
  for (const b of bookmarks) {
    items.push({
      id: `bm:${b.id}`,
      ts: b.createdAt,
      dotClass: "bg-pop",
      label: "收藏书签",
      title: b.title,
      href: "/home/bookmarks",
    })
  }
  for (const f of files) {
    items.push({
      id: `f:${f.id}`,
      ts: f.createdAt,
      dotClass: "bg-pop",
      label: "添加资源",
      title: f.name,
      href: "/home/resources",
    })
  }
  return items.sort((a, b) => b.ts - a.ts).slice(0, 14)
}

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
      if (!alive) return
      setData({
        subs,
        bookmarks: bookmarks.length,
        files: files.length,
        threads: threadCount,
        flow: buildFlow(subs, bookmarks, files),
        pinnedTools: subs.filter((s) => s.type === "tool"),
      })
    }
    load()
    // 同会话内任意回流 / 跨端同步后刷新仪表盘 (onHubUpdated 同听 HUB_UPDATED + SUBSCRIPTIONS_SYNCED)
    const off = onHubUpdated(load)
    return () => {
      alive = false
      off()
    }
  }, [])

  if (!data) {
    return (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[78px] animate-pulse rounded-2xl border bg-muted/40" />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-2xl border bg-muted/40" />
      </div>
    )
  }

  const isEmpty =
    data.subs.length === 0 && data.bookmarks === 0 && data.files === 0 && data.threads === 0

  if (isEmpty) return <EmptyHub />

  return (
    <div className="flex flex-col gap-4">
      {/* 便当: 统计磁贴 */}
      <HubStatTiles
        subs={data.subs.length - data.pinnedTools.length}
        bookmarks={data.bookmarks}
        files={data.files}
        threads={data.threads}
      />

      {/* 便当: 最近回流 (大块, 脊柱) + 右列 (去发现 / AI 快问) */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-l-2 border-l-pop bg-card p-5 shadow-sm lg:col-span-2">
          <div className="mb-4 flex items-center gap-2">
            <h2 className="text-sm font-semibold">最近回流</h2>
            <span className="text-xs text-muted-foreground">· 实时 · 都落在本机</span>
          </div>
          {data.flow.length > 0 ? (
            <RecentFlowback items={data.flow} />
          ) : (
            <p className="text-sm text-muted-foreground">还没有回流记录。去「发现」订阅或收藏。</p>
          )}
        </div>

        <div className="flex flex-col gap-4">
          {/* 去发现 */}
          <div className="rounded-2xl border bg-card p-5 shadow-sm">
            <h2 className="mb-1 text-sm font-semibold">去发现，带东西回家</h2>
            <p className="mb-4 text-xs text-muted-foreground">资讯 · 社区 · 工具，都能回流到这里</p>
            <div className="flex flex-col gap-2.5">
              {SPOKES.map((s) => (
                <Link
                  key={s.href}
                  href={s.href}
                  className="group flex items-start gap-3 rounded-xl border bg-background p-3 transition-colors hover:border-foreground/20 hover:bg-accent"
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

          {/* AI 快问 */}
          <Link
            href="/home/agent"
            className="group rounded-2xl border bg-gradient-to-br from-primary/10 to-spoke-tool/5 p-5 shadow-sm transition-colors hover:border-primary/30"
          >
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold">AI 快问</h2>
              <span className="ml-auto rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground">
                BYO-key
              </span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">问点什么，可读取中枢数据 · 自带密钥</p>
            <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary">
              打开 AI 助手
              <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </span>
          </Link>
        </div>
      </div>

      {/* 便当: 已钉工具 (整行) */}
      {data.pinnedTools.length > 0 && (
        <div className="rounded-2xl border bg-card p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Pin className="h-3.5 w-3.5" />
            已钉工具
          </div>
          <div className="flex flex-wrap gap-2.5">
            {data.pinnedTools.map((t) => (
              <a
                key={t.id}
                href={t.key}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-xl border bg-background px-3 py-2 text-sm transition-colors hover:bg-accent"
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
    <div className="flex min-h-[55dvh] flex-col items-center justify-center rounded-2xl border border-dashed bg-card/50 px-6 py-12 text-center">
      <h3 className="text-lg font-semibold">「我的」还是空的</h3>
      <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
        去「发现」订阅或收藏，内容会回流到这里。
      </p>

      <div className="mt-10 flex flex-col items-center gap-3">
        <div className="inline-flex flex-col items-center rounded-2xl border-2 border-primary/20 bg-primary/5 px-8 py-4">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Hexagon className="h-4 w-4" />
            我的
          </span>
          <span className="text-xs text-muted-foreground">数据只存本机</span>
        </div>
        <div className="my-1 flex items-center gap-1 text-xs text-muted-foreground">
          <CornerDownLeft className="h-3.5 w-3.5" />
          回流
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {SPOKES.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="flex flex-col items-center gap-1 rounded-2xl border bg-background px-6 py-4 text-center transition-colors hover:bg-accent"
            >
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                <span className={cn("h-2 w-2 rounded-full", s.dot)} />
                {s.label}
              </span>
              <span className="text-xs font-medium text-primary">去这里带东西回家 →</span>
            </Link>
          ))}
        </div>
      </div>

      <p className="mt-8 text-xs text-muted-foreground">
        按 <kbd className="rounded border bg-muted px-1.5 font-sans text-[10px]">⌘K</kbd> 呼出命令台
      </p>
    </div>
  )
}
