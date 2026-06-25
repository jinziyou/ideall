"use client"

import * as React from "react"
import Link from "next/link"
import {
  ArrowUpRight,
  Bookmark,
  CornerDownLeft,
  FolderOpen,
  Hexagon,
  NotebookPen,
  Pin,
  Sparkles,
  Wrench,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { safeHref } from "@/lib/safe-url"
import CommandTrigger from "@/shared/command-trigger"
import { SUB_SPOKE_META } from "@/files/spoke-meta"
import { SPOKES } from "@/shell/nav-config"
import { listSubscriptions } from "@/files/stores/subscriptions-store"
import { listBookmarks } from "@/files/stores/bookmarks-store"
import { listFiles } from "@/files/stores/files-store"
import { listNotes } from "@/files/stores/notes-store"
import { countAgentThreads } from "@/files/stores/agent-threads-count"
import { onFilesUpdated } from "@protocol/flowback"
import type { Subscription } from "./model"
import { StatTiles } from "./stat-tiles"
import { RecentFlowback, type FlowItem } from "./recent-flowback"

type OverviewData = {
  subs: Subscription[]
  notes: number
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
  notes: { id: string; title: string; createdAt: number }[],
): FlowItem[] {
  const items: FlowItem[] = []
  for (const n of notes) {
    items.push({
      // 与 关注/书签/资源 一致, 用 createdAt (收进「我的」的时间) 而非 updatedAt,
      // 否则反复编辑同一篇会不断把它顶到关注时间线最前、挤掉真正的新增。
      id: `note:${n.id}`,
      ts: n.createdAt,
      dotClass: "bg-pop",
      label: "写笔记",
      title: n.title || "无标题",
      href: "/home/notes",
    })
  }
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

export default function Overview() {
  const [data, setData] = React.useState<OverviewData | null>(null)

  React.useEffect(() => {
    let alive = true
    async function load() {
      // 每个 store 各自兜底: 单个仓库失败不应把整个「我的」清空成「空态」(否则有数据的用户会误见 onboarding)
      const [subs, bookmarks, files, notes, threadCount] = await Promise.all([
        listSubscriptions().catch(() => [] as Subscription[]),
        listBookmarks().catch(() => []),
        listFiles().catch(() => []),
        // 关注时间线只用 标题/时间, 跳过对每条笔记的全文 walk
        listNotes({ text: false }).catch(() => []),
        countAgentThreads().catch(() => 0),
      ])
      if (!alive) return
      setData({
        subs,
        notes: notes.length,
        bookmarks: bookmarks.length,
        files: files.length,
        threads: threadCount,
        flow: buildFlow(subs, bookmarks, files, notes),
        pinnedTools: subs.filter((s) => s.type === "tool"),
      })
    }
    load()
    // 同会话内任意关注 / 跨端同步后刷新仪表盘 (onFilesUpdated 同听 FILES_UPDATED + SUBSCRIPTIONS_SYNCED)。
    // 防抖: 批量写 (如导入书签) 会密集触发事件, 合并为一次重载, 避免每次写都整库重读。
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = onFilesUpdated(() => {
      clearTimeout(timer)
      timer = setTimeout(load, 250)
    })
    return () => {
      alive = false
      clearTimeout(timer)
      off()
    }
  }, [])

  if (!data) {
    return (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-[78px] animate-pulse rounded-2xl border bg-muted/40" />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-2xl border bg-muted/40" />
      </div>
    )
  }

  const isEmpty =
    data.subs.length === 0 &&
    data.notes === 0 &&
    data.bookmarks === 0 &&
    data.files === 0 &&
    data.threads === 0

  if (isEmpty) return <EmptyOverview />

  return (
    <div className="flex flex-col gap-4">
      {/* 便当: 统计磁贴 */}
      <StatTiles
        subs={data.subs.length - data.pinnedTools.length}
        notes={data.notes}
        bookmarks={data.bookmarks}
        files={data.files}
        threads={data.threads}
      />

      {/* 便当: 最近关注 (大块, 脊柱) + 右列 (去发现 / AI 快问) */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-l-2 border-l-pop bg-card p-5 shadow-sm lg:col-span-2">
          <div className="mb-4 flex items-center gap-2">
            <h2 className="text-sm font-semibold">最近关注</h2>
            <span className="text-xs text-muted-foreground">· 实时更新 · 都存在本机</span>
          </div>
          {data.flow.length > 0 ? (
            <RecentFlowback items={data.flow} />
          ) : (
            <p className="text-sm text-muted-foreground">还没有关注记录。去「发现」关注或收藏。</p>
          )}
        </div>

        <div className="flex flex-col gap-4">
          {/* 去发现 */}
          <div className="rounded-2xl border bg-card p-5 shadow-sm">
            <h2 className="mb-1 text-sm font-semibold">去发现，带东西回家</h2>
            <p className="mb-4 text-xs text-muted-foreground">资讯 · 社区 · 工具，都能汇入这里</p>
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
                自带密钥
              </span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              问点什么，结合「我的」里的数据作答 · 密钥只存本机
            </p>
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
                href={safeHref(t.key)}
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

/** 空「我的」「本机即可开始」梯队: 全部零后端 / 离线可用, 排在依赖远端的发现模块之前, 保证新用户首个动作必成功。 */
const LOCAL_STARTERS = [
  { href: "/home/notes", label: "写笔记", icon: NotebookPen, hint: "块编辑，像 Notion" },
  { href: "/home/bookmarks", label: "收藏书签", icon: Bookmark, hint: "可导入浏览器书签" },
  { href: "/home/resources", label: "上传资源", icon: FolderOpen, hint: "文件只存本机" },
]

/**
 * 空「我的」: 先给「本机即可开始」的零后端抓手 (无需联网 / 账号), 再用发现模块→关注的示意图讲清关注心智。
 * 「关注」在副标题里用白话点明 (收进「我的」), 命令台入口改为可点 (触屏也能用)。
 */
function EmptyOverview() {
  return (
    <div className="flex min-h-[55dvh] flex-col items-center justify-center rounded-2xl border border-dashed bg-card/50 px-6 py-12 text-center">
      <span className="flex items-center gap-2 text-lg font-semibold">
        <Hexagon className="h-5 w-5" />
        「我的」还是空的
      </span>
      <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
        在本机写点、存点，或去「发现」关注来源 —— 内容都会收进这里。
      </p>

      {/* 第一梯队: 本机即可开始 (零后端, 离线可用), 确保首个动作必成功 */}
      <div className="mt-8 w-full max-w-xl">
        <div className="mb-2.5 text-xs font-medium text-primary">本机即可开始 · 无需联网或账号</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {LOCAL_STARTERS.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="flex flex-col items-center gap-1 rounded-2xl border-2 border-primary/20 bg-primary/5 px-4 py-4 text-center transition-colors hover:border-primary/40 hover:bg-primary/10"
            >
              <s.icon className="h-5 w-5 text-primary" />
              <span className="text-sm font-semibold">{s.label}</span>
              <span className="text-xs text-muted-foreground">{s.hint}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* 第二梯队: 从「发现」带内容回来 (依赖后端 / 远端来源) */}
      <div className="mt-10 flex w-full max-w-xl flex-col items-center gap-3">
        <div className="text-xs text-muted-foreground">或从「发现」带内容回来</div>
        <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
          {SPOKES.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="flex flex-col items-center gap-1 rounded-2xl border bg-background px-4 py-4 text-center transition-colors hover:bg-accent"
            >
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                <span className={cn("h-2 w-2 rounded-full", s.dot)} />
                {s.label}
              </span>
              <span className="text-xs text-muted-foreground">{s.hint}</span>
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <CornerDownLeft className="h-3.5 w-3.5" />
          关注 / 收藏后自动收进「我的」
        </div>
      </div>

      {/* 命令台入口: 触屏可点; ⌘K 仅桌面尺寸显示 */}
      <CommandTrigger className="mt-8 w-full max-w-xs" />
    </div>
  )
}
