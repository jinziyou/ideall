"use client"

import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { Button } from "@/components/ui/button"
import { formatTimestamp } from "@/lib/format"
import { SubscribeButton } from "@/app/home/subscribe-button"
import type { NameEntity, Publisher } from "./model"

/**
 * info 表格的共享单元格 —— 实体页 / 发布者页 / 搜索页三套列定义复用这些渲染块,
 * 避免「同一种单元格在多处各写一遍」导致的样式/时区漂移 (历史上时间列就出现过本地/UTC 不一致)。
 */

/** 标题截断: 超长时保留头尾、中间省略号, 兼顾可读性与列宽对齐。 */
export function truncate(text: string, max: number): string {
  if (!text || text.length <= max) return text
  const head = text.substring(0, Math.max(8, Math.floor(max * 0.6)))
  const tail = text.substring(text.length - Math.max(4, Math.floor(max * 0.25)))
  return `${head}…${tail}`
}

/** 标题单元格: 点击新开原文, 超长时 hover 显示全文。 */
export function TitleCell({ title, url, max = 30 }: { title: string; url: string; max?: number }) {
  const trigger = (
    <Button
      className="h-auto max-w-[260px] justify-start p-0 text-left"
      variant="link"
      onClick={() => window.open(url, "_blank")}
    >
      <span className="truncate">{truncate(title, max)}</span>
    </Button>
  )
  if (title.length <= max) return trigger
  return (
    <HoverCard>
      <HoverCardTrigger asChild>{trigger}</HoverCardTrigger>
      <HoverCardContent className="max-w-sm text-sm">{title}</HoverCardContent>
    </HoverCard>
  )
}

/** 命名实体单元格: 按 人物(PER)/组织(ORG)/地区(LOC) 分组展示。 */
export function EntityCell({ entities }: { entities: NameEntity[] | undefined }) {
  const per: string[] = []
  const org: string[] = []
  const loc: string[] = []
  for (const e of entities ?? []) {
    if (e.label === "PER") per.push(e.name)
    else if (e.label === "ORG") org.push(e.name)
    else if (e.label === "LOC") loc.push(e.name)
  }
  const empty = per.length + org.length + loc.length === 0
  return (
    <div className="min-w-[160px] space-y-0.5 text-xs">
      {per.length > 0 && <div>人物: {per.join(", ")}</div>}
      {org.length > 0 && <div>组织: {org.join(", ")}</div>}
      {loc.length > 0 && <div>地区: {loc.join(", ")}</div>}
      {empty && <span className="text-muted-foreground">-</span>}
    </div>
  )
}

/** 发布者单元格 (hover 显示域名, 并可就地订阅该发布者)。 */
export function PublisherHoverCell({ publisher }: { publisher: Publisher | undefined }) {
  if (!publisher) return <span className="text-muted-foreground">-</span>
  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <Button className="h-auto p-0 text-xs" variant="link">
          {publisher.name || publisher.domain}
        </Button>
      </HoverCardTrigger>
      <HoverCardContent className="flex flex-col items-start gap-2 text-xs">
        <span className="text-muted-foreground">{publisher.domain}</span>
        <SubscribeButton
          sub={{ type: "publisher", key: publisher.domain, title: publisher.name || publisher.domain }}
        />
      </HoverCardContent>
    </HoverCard>
  )
}

/** 右对齐时间单元格 (本地时区, 见 @/lib/format)。 */
export function TimeCell({ value }: { value: number | string | undefined | null }) {
  return <div className="text-right text-xs font-medium">{formatTimestamp(value)}</div>
}
