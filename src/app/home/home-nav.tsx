"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { HardDrive } from "lucide-react"
import { cn } from "@/components/lib/utils"
import { HOME_SUBPAGES, type NavLink } from "@/app/nav/nav-config"
import { listFiles } from "./lib/files-store"
import { listBookmarks } from "./lib/bookmarks-store"
import { listSubscriptions } from "./lib/subscriptions-store"
import { listNotes } from "./lib/notes-store"
import { countAgentThreads } from "./lib/agent-threads-count"
import { formatBytes } from "@/components/lib/hub-format"

/**
 * 我的左侧分区导航: 资源 / 书签 走独立路由, 并展示数量与本地存储用量。
 * 计数与用量在路由切换时刷新, 以反映另一区的增删。
 */
export default function HomeNav() {
  const pathname = usePathname()
  const [subCount, setSubCount] = React.useState<number | null>(null)
  const [fileCount, setFileCount] = React.useState<number | null>(null)
  const [bookmarkCount, setBookmarkCount] = React.useState<number | null>(null)
  const [noteCount, setNoteCount] = React.useState<number | null>(null)
  const [threadCount, setThreadCount] = React.useState<number | null>(null)
  const [usage, setUsage] = React.useState(0)
  const [quota, setQuota] = React.useState(0)

  React.useEffect(() => {
    let alive = true
    async function load() {
      try {
        const [files, bookmarks, subs, notes, threadCount] = await Promise.all([
          listFiles(),
          listBookmarks(),
          listSubscriptions(),
          listNotes(),
          countAgentThreads(),
        ])
        if (!alive) return
        setFileCount(files.length)
        setBookmarkCount(bookmarks.length)
        setSubCount(subs.length)
        setNoteCount(notes.length)
        setThreadCount(threadCount)
      } catch {
        /* 本地读取失败时静默, 不影响导航 */
      }
      try {
        const est = await navigator.storage?.estimate?.()
        if (alive && est) {
          setUsage(est.usage ?? 0)
          setQuota(est.quota ?? 0)
        }
      } catch {
        /* StorageManager 不可用时忽略用量条 */
      }
    }
    load()
    return () => {
      alive = false
    }
  }, [pathname])

  const counts: Record<string, number | null> = {
    "/home": null,
    "/home/notes": noteCount,
    "/home/subscriptions": subCount,
    "/home/agent": threadCount,
    "/home/publications": null,
    "/home/resources": fileCount,
    "/home/bookmarks": bookmarkCount,
  }
  const pct = quota > 0 ? Math.min(100, (usage / quota) * 100) : 0

  const hubItems = HOME_SUBPAGES.filter((p) => p.group !== "system")
  const systemItems = HOME_SUBPAGES.filter((p) => p.group === "system")

  const renderEntry = ({ href, label, icon: Icon }: NavLink) => {
    // 概览 (/home) 仅精确匹配, 否则会被所有 /home/* 子页命中
    const active =
      href === "/home" ? pathname === "/home" : pathname === href || pathname.startsWith(href + "/")
    const count = counts[href]
    return (
      <Link
        key={href}
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex shrink-0 items-center gap-3 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm transition-colors md:shrink",
          active
            ? "bg-primary/10 font-medium text-primary md:border-l-2 md:border-primary md:pl-[10px]"
            : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        )}
      >
        <Icon className="h-4 w-4" />
        <span className="flex-1 text-left">{label}</span>
        {count !== null && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            {count}
          </span>
        )}
      </Link>
    )
  }

  return (
    <aside className="md:w-56 md:shrink-0">
      <nav className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
        {hubItems.map(renderEntry)}
        {/* 系统能力组: 桌面分隔线 + 组标签, 移动横滚降级为竖线分隔 */}
        <span className="mx-1 w-px shrink-0 self-stretch bg-border md:hidden" />
        <div className="my-2 hidden border-t md:block" />
        <span className="hidden px-3 pb-1 text-[11px] font-medium text-muted-foreground md:block">
          系统服务
        </span>
        {systemItems.map(renderEntry)}
      </nav>

      {quota > 0 && (
        <div className="mt-4 hidden rounded-2xl border bg-card p-3 text-xs text-muted-foreground md:block">
          <div className="mb-1 flex items-center gap-1.5 font-medium text-foreground">
            <HardDrive className="h-3.5 w-3.5" />
            本地存储
          </div>
          <div className="mb-2">已用 {formatBytes(usage)}</div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}
    </aside>
  )
}
