"use client"

import * as React from "react"
import { ExternalLink, Loader2, RotateCw } from "lucide-react"
import { cn } from "@/components/lib/utils"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useApiResult } from "@/components/lib/use-api-result"
import { infoDisplayTitle, formatTimestamp } from "@/components/lib/format"
import { openExternal } from "@/components/lib/safe-url"
import { SaveToHub } from "@/components/feeders"
import { fetchInfoEvents } from "./data"
import type { Info, InfoEvent } from "./model"
import { rankEventsByTrend } from "./derive"
import { EntityCell } from "./cells"
import HotEntities from "./hot-entities"

const HOUR_MS = 60 * 60 * 1000

const RANGE_OPTIONS: { value: string; text: string; ms?: number }[] = [
  { value: "all", text: "全部" },
  { value: "24h", text: "24 小时", ms: 24 * HOUR_MS },
  { value: "3d", text: "3 天", ms: 3 * 24 * HOUR_MS },
  { value: "7d", text: "7 天", ms: 7 * 24 * HOUR_MS },
  { value: "30d", text: "30 天", ms: 30 * 24 * HOUR_MS },
]

type ViewMode = "hot" | "latest"

/** /info/analysis 深链 (「全面报道」聚合页)。 */
const analysisLink = (url: string) => `/info/analysis?url=${encodeURIComponent(url)}`

/** Info.publisher → SaveToHub / 订阅 入参 (domain 缺失则不提供订阅)。 */
function pubOf(info: Info): { domain: string; name?: string } | undefined {
  const domain = info.publisher?.domain
  return domain ? { domain, name: info.publisher?.name ?? undefined } : undefined
}

function publisherText(info: Info): string {
  return info.publisher?.name || info.publisher?.domain || "未知来源"
}

/**
 * /info 三栏阅读器 (Readwise / Folo 式, 建在现有 server-port 取数上):
 *   左 = 筛选 (视图 / 时间段) + 热门实体;  中 = 事件故事列表 (可选);  右 = 选中故事的「全面报道」(lead + 各来源)。
 * 数据无正文 (仅元数据 + 原文链接 + 事件聚类), 故右栏呈现「同一事件的多来源报道」, 一键「收入中枢」。
 * 三视图共用一次 /info/events 取数, 切换零额外请求。
 */
export default function InfoReader() {
  const [mode, setMode] = React.useState<ViewMode>("hot")
  const [range, setRange] = React.useState("all")
  const [selectedUrl, setSelectedUrl] = React.useState<string | null>(null)

  const { data, loading, error, reload } = useApiResult<InfoEvent[]>(
    () => {
      const ms = RANGE_OPTIONS.find((o) => o.value === range)?.ms
      return fetchInfoEvents(ms ? { timestamp_from_to: [Date.now() - ms, Date.now()] } : {})
    },
    [],
    [range],
  )

  const events = React.useMemo(() => {
    if (mode === "hot") return rankEventsByTrend(data)
    return [...data].sort((a, b) => b.lead.collect_time - a.lead.collect_time)
  }, [data, mode])

  // 选中故事: 跟随用户点击, 否则回退到列表首条 (无 effect, 渲染期派生即可)。
  const selected = events.find((e) => e.lead.url === selectedUrl) ?? events[0] ?? null

  return (
    <div className="grid gap-4 lg:grid-cols-[200px_minmax(0,340px)_minmax(0,1fr)]">
      {/* 左: 筛选 + 热门实体 */}
      <aside className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
        <Tabs value={mode} onValueChange={(v) => setMode(v as ViewMode)}>
          <TabsList className="w-full">
            <TabsTrigger value="hot" className="flex-1">
              热点
            </TabsTrigger>
            <TabsTrigger value="latest" className="flex-1">
              最新
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Select value={range} onValueChange={setRange}>
          <SelectTrigger className="h-9 w-full" aria-label="时间段">
            <SelectValue placeholder="时间段" />
          </SelectTrigger>
          <SelectContent>
            {RANGE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.text}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <HotEntities />
      </aside>

      {/* 中: 事件故事列表 */}
      <div className="overflow-hidden rounded-2xl border bg-card lg:sticky lg:top-4 lg:max-h-[80dvh] lg:self-start lg:overflow-y-auto">
        {loading ? (
          <div className="flex h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            加载中…
          </div>
        ) : error ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            加载失败
            <button
              type="button"
              onClick={reload}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs hover:bg-accent"
            >
              <RotateCw className="h-3.5 w-3.5" />
              重试
            </button>
          </div>
        ) : events.length === 0 ? (
          <div className="flex h-40 items-center justify-center px-4 text-center text-sm text-muted-foreground">
            这个时间段还没有信息。
          </div>
        ) : (
          <ul>
            {events.map((ev) => {
              const active = selected?.lead.url === ev.lead.url
              return (
                <li key={ev.lead.url}>
                  <button
                    type="button"
                    onClick={() => setSelectedUrl(ev.lead.url)}
                    className={cn(
                      "w-full border-b px-4 py-3 text-left transition-colors hover:bg-accent/50",
                      active && "bg-accent",
                    )}
                  >
                    <div className="line-clamp-2 text-sm font-medium">
                      {infoDisplayTitle(ev.lead.title ?? "") || ev.lead.url}
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="truncate">{publisherText(ev.lead)}</span>
                      {ev.source_count > 1 && (
                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5">
                          {ev.source_count} 来源
                        </span>
                      )}
                      <span className="ml-auto shrink-0 whitespace-nowrap tabular-nums">
                        {formatTimestamp(ev.lead.collect_time)}
                      </span>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* 右: 阅读 / 全面报道 */}
      <div className="rounded-2xl border bg-card lg:sticky lg:top-4 lg:max-h-[80dvh] lg:self-start lg:overflow-y-auto">
        {selected ? (
          <EventDetail event={selected} />
        ) : (
          <div className="flex h-40 items-center justify-center px-4 text-center text-sm text-muted-foreground">
            {loading ? "" : "选择左侧一条事件查看全面报道。"}
          </div>
        )}
      </div>
    </div>
  )
}

function EventDetail({ event }: { event: InfoEvent }) {
  const { lead } = event
  const title = infoDisplayTitle(lead.title ?? "") || lead.url
  const reports = [lead, ...event.related]

  return (
    <article className="p-5">
      <div className="flex items-start gap-2">
        <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-spoke-info" />
        <h2 className="text-lg font-semibold leading-snug">{title}</h2>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <button
          type="button"
          onClick={() => openExternal(lead.url)}
          className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
        >
          打开原文
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
        <span>· {publisherText(lead)}</span>
        <span>· {formatTimestamp(lead.collect_time)}</span>
      </div>

      {lead.labels && lead.labels.length > 0 && (
        <div className="mt-3">
          <EntityCell entities={lead.labels} />
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <SaveToHub
          variant="icon"
          bookmark={{ title: lead.title ?? lead.url, url: lead.url }}
          publisher={pubOf(lead)}
          openUrl={lead.url}
          analysisUrl={analysisLink(lead.url)}
        />
        <span className="text-xs text-muted-foreground">收藏 / 订阅发布者 · 回流到「我的」</span>
      </div>

      <h3 className="mt-6 text-sm font-semibold">
        全面报道
        <span className="ml-1.5 font-normal text-muted-foreground">· {reports.length} 个来源</span>
      </h3>
      <ul className="mt-1">
        {reports.map((r, i) => (
          <li key={`${r.url}-${i}`} className="border-t py-3">
            <button
              type="button"
              onClick={() => openExternal(r.url)}
              className="line-clamp-2 text-left text-sm hover:underline"
            >
              {infoDisplayTitle(r.title ?? "") || r.url}
            </button>
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="truncate">{publisherText(r)}</span>
              <span className="ml-auto shrink-0 whitespace-nowrap tabular-nums">
                {formatTimestamp(r.collect_time)}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </article>
  )
}
