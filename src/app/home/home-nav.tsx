"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Bookmark, Bot, FolderOpen, HardDrive, Megaphone, Rss } from "lucide-react"
import { cn } from "@/lib/utils"
import { listFiles } from "./lib/files-store"
import { listBookmarks } from "./lib/bookmarks-store"
import { listSubscriptions } from "./lib/subscriptions-store"
import { listThreads } from "./lib/agent-store"
import { formatBytes } from "./lib/format"

type NavEntry = {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
}

const ENTRIES: NavEntry[] = [
  { href: "/home/subscriptions", label: "订阅", icon: Rss },
  { href: "/home/agent", label: "AI 助手", icon: Bot },
  { href: "/home/publications", label: "我的发布", icon: Megaphone },
  { href: "/home/resources", label: "资源管理", icon: FolderOpen },
  { href: "/home/bookmarks", label: "书签管理", icon: Bookmark },
]

/**
 * 我的空间左侧分区导航: 资源 / 书签 走独立路由, 并展示数量与本地存储用量。
 * 计数与用量在路由切换时刷新, 以反映另一区的增删。
 */
export default function HomeNav() {
  const pathname = usePathname()
  const [subCount, setSubCount] = React.useState<number | null>(null)
  const [fileCount, setFileCount] = React.useState<number | null>(null)
  const [bookmarkCount, setBookmarkCount] = React.useState<number | null>(null)
  const [threadCount, setThreadCount] = React.useState<number | null>(null)
  const [usage, setUsage] = React.useState(0)
  const [quota, setQuota] = React.useState(0)

  React.useEffect(() => {
    let alive = true
    async function load() {
      try {
        const [files, bookmarks, subs, threads] = await Promise.all([
          listFiles(),
          listBookmarks(),
          listSubscriptions(),
          listThreads(),
        ])
        if (!alive) return
        setFileCount(files.length)
        setBookmarkCount(bookmarks.length)
        setSubCount(subs.length)
        setThreadCount(threads.length)
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
    "/home/subscriptions": subCount,
    "/home/agent": threadCount,
    "/home/publications": null,
    "/home/resources": fileCount,
    "/home/bookmarks": bookmarkCount,
  }
  const pct = quota > 0 ? Math.min(100, (usage / quota) * 100) : 0

  return (
    <aside className="md:w-56 md:shrink-0">
      <nav className="flex gap-1 md:flex-col">
        {ENTRIES.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/")
          const count = counts[href]
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-1 items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors md:flex-none",
                active ? "bg-accent font-medium" : "hover:bg-accent/60",
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
        })}
      </nav>

      {quota > 0 && (
        <div className="mt-4 hidden rounded-lg border bg-card p-3 text-xs text-muted-foreground md:block">
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
