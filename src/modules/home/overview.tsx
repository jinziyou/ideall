"use client"

// 「我的 · 概览」仪表盘: 区段入口 (关注/书签/资源/文件/工作区) + 最近动态。
// 入口点击经 openTarget 打开区段文件，由默认引擎生成对应 Display。
// 全部本地优先: 计数与动态只读本机数据; 发布是远端身份动作。

import * as React from "react"
import { ArrowRight, Bot, Database, Inbox, ShieldCheck } from "lucide-react"
import { cn } from "@/lib/utils"
import { openTarget, setRightPanel } from "@/workspace/store"
import { HOME_PLACES } from "@/workspace/tree/home-places"
import { watchFileSet } from "@/filesystem/watch-set"
import { corePlaceRef } from "@/filesystem/resource-file-system"
import { Button } from "@/ui/button"
import { Chip } from "@/ui/chip"
import { EmptyState } from "@/ui/empty-state"
import { Panel } from "@/ui/panel"
import { StatusDot } from "@/ui/status-dot"
import { loadHomeOverviewData, type HomeOverviewData } from "./home-read-model"
import { RecentActivity } from "./recent-activity"
import { RecentlyOpenedPanel } from "./recently-opened"

const OVERVIEW_ROOTS = ["subscriptions", "bookmarks", "files", "notes", "workspace"].map((place) =>
  corePlaceRef(place as Parameters<typeof corePlaceRef>[0]),
)
const WATCH_CONTEXT = { actor: "ui", permissions: [], intent: "watch" } as const

const SECTION_TONE = {
  inbox: "warn",
  subscriptions: "info",
  bookmarks: "idle",
  resources: "warn",
  notes: "ok",
  workspace: "info",
} as const

const NEXT_ACTIONS = [
  {
    id: "subscriptions",
    title: "添加关注源",
    description: "从发布者、实体或搜索词开始，让首页先长出信息流。",
  },
  {
    id: "bookmarks",
    title: "导入书签",
    description: "把待读链接放回本机索引，后续可离线检索。",
  },
  {
    id: "workspace",
    title: "询问本地资料",
    description: "打开 AI 侧栏，用自己的文件、书签、资源和对话做问答。",
  },
] as const

function openHomeSection(id: string) {
  const place = HOME_PLACES.find((s) => s.id === id)
  if (place?.defaultPath) {
    openTarget({ type: "path", path: place.defaultPath })
    return
  }
  setRightPanel(true)
}

function formatCount(loaded: boolean, count: number | undefined) {
  if (!loaded) return "·"
  return typeof count === "number" ? String(count) : "—"
}

export default function Overview() {
  const [data, setData] = React.useState<HomeOverviewData | null>(null)

  React.useEffect(() => {
    let alive = true
    async function load() {
      const next = await loadHomeOverviewData()
      if (!alive) return
      setData(next)
    }
    load()
    // 合并多个目录的密集 watch 事件，避免一次批量同步触发重复全量投影。
    let timer: ReturnType<typeof setTimeout> | undefined
    const watch = watchFileSet(OVERVIEW_ROOTS, WATCH_CONTEXT, () => {
      clearTimeout(timer)
      timer = setTimeout(load, 250)
    })
    return () => {
      alive = false
      clearTimeout(timer)
      watch?.dispose()
    }
  }, [])

  const loaded = data !== null
  const totalLocal = data
    ? Object.entries(data.counts).reduce<number>(
        (sum, [key, count]) => sum + (key !== "inbox" && typeof count === "number" ? count : 0),
        0,
      )
    : undefined
  const recentCount = data?.activity.length

  return (
    <div className="flex w-full flex-col gap-4 lg:gap-5">
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
        <Panel className="overflow-hidden">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Chip tone="info">本地优先</Chip>
                <Chip>无账号工作台</Chip>
              </div>
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
                今天从这里继续：读、整理、再交给 AI
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                概览不只展示计数：它把本机关注、书签、资源、文件和工作区对话压到同一屏，
                让空库也有明确的下一步，数据仍只落在本机。
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button size="sm" onClick={() => openHomeSection("subscriptions")}>
                整理关注
              </Button>
              <Button size="sm" variant="outline" onClick={() => openHomeSection("bookmarks")}>
                导入书签
              </Button>
              <Button size="sm" variant="outline" onClick={() => openHomeSection("workspace")}>
                打开 AI
              </Button>
            </div>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border bg-background/50 p-3">
              <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <StatusDot tone="ok" />
                本机条目
              </div>
              <p className="mt-2 text-2xl font-semibold tabular-nums">
                {loaded ? totalLocal : "·"}
              </p>
            </div>
            <div className="rounded-lg border bg-background/50 p-3">
              <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <StatusDot tone="info" />
                最近动态
              </div>
              <p className="mt-2 text-2xl font-semibold tabular-nums">
                {loaded ? recentCount : "·"}
              </p>
            </div>
            <div className="rounded-lg border bg-background/50 p-3">
              <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <StatusDot tone="idle" />
                存储位置
              </div>
              <p className="mt-2 text-sm font-medium">本机 IndexedDB</p>
            </div>
          </div>
        </Panel>

        {/* 区段入口: 关注 / 书签 / 资源 / 文件 / 工作区 */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-3">
          {HOME_PLACES.map((s) => {
            const Icon = s.icon
            const count = data?.counts[s.id]
            const tone = SECTION_TONE[s.id as keyof typeof SECTION_TONE] ?? "idle"
            return (
              <button
                key={s.id}
                type="button"
                // 无面板区段 (工作区): 点击呼出右侧 AI 栏 (对话的交互主场)。
                onClick={() => openHomeSection(s.id)}
                className="group flex min-h-24 flex-col justify-between rounded-lg border bg-card p-4 text-left transition-colors hover:border-foreground/20 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
                  <Icon className="h-3.5 w-3.5" />
                  {s.label}
                </span>
                <span className="flex items-end justify-between gap-3">
                  <span
                    className={cn(
                      "text-2xl font-semibold tabular-nums",
                      data ? undefined : "text-muted-foreground/40",
                    )}
                  >
                    {formatCount(loaded, count)}
                  </span>
                  <StatusDot tone={tone} className="mb-1" />
                </span>
              </button>
            )
          })}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
        <Panel title="最近动态" className="min-h-[320px]">
          {!data ? (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-5 animate-pulse rounded bg-muted/40" />
              ))}
            </div>
          ) : data.activity.length > 0 ? (
            <RecentActivity items={data.activity} />
          ) : (
            <EmptyState
              icon={Inbox}
              title="本机还没有最近动态"
              description="添加关注、书签、资源或文件后，新的本地动作会按时间出现在这里。"
              bordered={false}
              className="py-8"
              action={
                <>
                  <Button size="sm" onClick={() => openHomeSection("subscriptions")}>
                    添加关注源
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openHomeSection("bookmarks")}>
                    导入书签
                  </Button>
                </>
              }
            />
          )}
        </Panel>

        <div className="grid gap-4">
          <Panel title="下一步">
            <div className="flex flex-col gap-2">
              {NEXT_ACTIONS.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => openHomeSection(action.id)}
                  className="flex items-start gap-3 rounded-lg border bg-background/50 p-2.5 text-left transition-colors hover:border-foreground/20 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{action.title}</span>
                    <span className="mt-0.5 block text-[13px] leading-relaxed text-muted-foreground">
                      {action.description}
                    </span>
                  </span>
                </button>
              ))}
            </div>

            <div className="mt-4 border-t pt-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                <ShieldCheck className="h-4 w-4 text-success" />
                本地状态
              </div>
              <div className="grid gap-2 text-[13px] leading-relaxed text-muted-foreground">
                <div className="flex items-start gap-2">
                  <StatusDot tone="ok" className="mt-1.5" />
                  <span>关注、书签、资源、文件和对话从本地 stores 读取。</span>
                </div>
                <div className="flex items-start gap-2">
                  <Database className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>首页保持静态导出可用，不引入服务端运行时。</span>
                </div>
                <div className="flex items-start gap-2">
                  <Bot className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>对话入口打开右侧 AI 栏，继续围绕本地资料工作。</span>
                </div>
              </div>
            </div>
          </Panel>

          <RecentlyOpenedPanel />
        </div>
      </section>
    </div>
  )
}
