"use client"

// 「我的 · 概览」极简仪表盘: 5 个区段入口 (关注/收藏/资源/发布/笔记) + 最近动态。
// 入口点击经 openTab 直接开/激活对应区段标签 (module:"home", 不切走「我的」侧栏)。
// 全部本地优先: 计数与动态只读本机数据 (发布是远端/登录态, 不在此计数)。

import * as React from "react"
import { cn } from "@/lib/utils"
import { listSubscriptions } from "@/files/stores/subscriptions-store"
import { listBookmarks } from "@/files/stores/bookmarks-store"
import { listFiles } from "@/files/stores/files-store"
import { listNotes } from "@/files/stores/notes-store"
import { onFilesUpdated } from "@protocol/flowback"
import { openTab } from "@/workspace/store"
import { HOME_SECTIONS } from "@/workspace/home-sections"
import { SUB_SPOKE_META } from "@/files/spoke-meta"
import type { Subscription } from "./model"
import { RecentFlowback, type FlowItem } from "./recent-flowback"

/** 本地区段计数 (按 HOME_SECTIONS.id 取; 发布为远端, 无本地计数 → undefined)。 */
type Counts = Record<string, number | undefined>

type OverviewData = { counts: Counts; flow: FlowItem[] }

function buildFlow(
  subs: Subscription[],
  bookmarks: { id: string; title: string; createdAt: number }[],
  files: { id: string; name: string; createdAt: number }[],
  notes: { id: string; title: string; createdAt: number }[],
): FlowItem[] {
  const items: FlowItem[] = []
  for (const n of notes) {
    // 用 createdAt (收进「我的」的时间) 而非 updatedAt, 否则反复编辑同一篇会不断顶到最前。
    items.push({
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
      label: "收藏",
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
  return items.sort((a, b) => b.ts - a.ts).slice(0, 12)
}

export default function Overview() {
  const [data, setData] = React.useState<OverviewData | null>(null)

  React.useEffect(() => {
    let alive = true
    async function load() {
      // 每个 store 各自兜底: 单仓库失败不应把整个概览清空。
      const [subs, bookmarks, files, notes] = await Promise.all([
        listSubscriptions().catch(() => [] as Subscription[]),
        listBookmarks().catch(() => []),
        listFiles().catch(() => []),
        listNotes({ text: false }).catch(() => []),
      ])
      if (!alive) return
      setData({
        counts: {
          // 关注计数排除已钉工具 (tool), 与「关注」语义一致。
          subscriptions: subs.filter((s) => s.type !== "tool").length,
          bookmarks: bookmarks.length,
          resources: files.length,
          notes: notes.length,
        },
        flow: buildFlow(subs, bookmarks, files, notes),
      })
    }
    load()
    // 同会话内任意关注 / 跨端同步后刷新 (防抖合并密集写)。
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

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      {/* 区段入口: 关注 / 收藏 / 资源 / 发布 / 笔记 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {HOME_SECTIONS.map((s) => {
          const Icon = s.icon
          const count = data?.counts[s.id]
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => openTab(s.descriptor)}
              className="flex flex-col gap-2 rounded-lg border bg-card p-4 text-left shadow-sm transition-colors hover:border-foreground/20 hover:bg-accent"
            >
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Icon className="h-3.5 w-3.5" />
                {s.label}
              </span>
              <span
                className={cn(
                  "text-2xl font-semibold tabular-nums",
                  data ? undefined : "text-muted-foreground/40",
                )}
              >
                {!data ? "·" : typeof count === "number" ? count : "—"}
              </span>
            </button>
          )
        })}
      </div>

      {/* 最近动态 (本机) */}
      <div className="rounded-lg border bg-card p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <h2 className="text-sm font-semibold">最近</h2>
        </div>
        {!data ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-5 animate-pulse rounded bg-muted/40" />
            ))}
          </div>
        ) : data.flow.length > 0 ? (
          <RecentFlowback items={data.flow} />
        ) : null}
      </div>
    </div>
  )
}
