"use client"

import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
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

/** 实体是否有可展示的百科词条 (has_entry 且至少一个词条链接)。 */
export function hasEncyclopediaEntry(e: NameEntity): boolean {
  return Boolean(e.has_entry && (e.baike_url || e.wikipedia_url))
}

/**
 * 把实体分为「有词条」(突出展示) 与「其余」(可能性低或不重要) 两组。
 * 分层维度按「是否有百科词条」而非实体类型 —— 故 EVENT/PRODUCT 不再被丢弃, 有词条即显眼。
 * TIME 实体无展示价值, 过滤掉 (写图时本就跳过)。
 */
export function partitionEntities(entities: NameEntity[] | undefined): {
  withEntry: NameEntity[]
  others: NameEntity[]
} {
  const withEntry: NameEntity[] = []
  const others: NameEntity[] = []
  for (const e of entities ?? []) {
    if (e.label === "TIME") continue
    if (hasEncyclopediaEntry(e)) withEntry.push(e)
    else others.push(e)
  }
  return { withEntry, others }
}

/** 实体的百科外链: 百度百科为主链接、维基百科为次链接。无链接则不渲染。 */
export function EntityEntryLinks({ entity }: { entity: NameEntity }) {
  return (
    <>
      {entity.baike_url && (
        <a
          href={entity.baike_url}
          target="_blank"
          rel="noopener noreferrer"
          title="百度百科"
          className="text-primary underline-offset-2 hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          百科
        </a>
      )}
      {entity.wikipedia_url && (
        <a
          href={entity.wikipedia_url}
          target="_blank"
          rel="noopener noreferrer"
          title="维基百科"
          className="text-muted-foreground underline-offset-2 hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          维基
        </a>
      )}
    </>
  )
}

/**
 * 命名实体单元格: 有词条实体作 Badge 突出展示 (附百科/维基链接),
 * 其余归到可折叠的「可能性低或不重要的实体」组。旧数据无 has_entry 时全部落入「其余」。
 */
export function EntityCell({ entities }: { entities: NameEntity[] | undefined }) {
  const { withEntry, others } = partitionEntities(entities)
  if (withEntry.length === 0 && others.length === 0) {
    return <span className="text-muted-foreground">-</span>
  }
  return (
    <div className="min-w-[180px] space-y-1 text-xs">
      {withEntry.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {withEntry.map((e, i) => (
            <Badge key={`${e.label}-${e.name}-${i}`} variant="secondary" className="gap-1 font-normal">
              <span>{e.name}</span>
              <EntityEntryLinks entity={e} />
            </Badge>
          ))}
        </div>
      )}
      {others.length > 0 && (
        <details className="text-muted-foreground">
          <summary className="cursor-pointer select-none">
            次要实体 ({others.length})
          </summary>
          <div className="mt-1">{others.map((e) => e.name).join(", ")}</div>
        </details>
      )}
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
