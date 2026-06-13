import { ColumnDef } from "@tanstack/react-table"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { Button } from "@/components/ui/button"
import { Info, InfoEvent } from "./model"
import { PublisherGroup } from "./derive"
import { EntityCell, PublisherHoverCell, TimeCell, TitleCell } from "./cells"
import { SaveToHub } from "@/components/feeders"
import { openExternal } from "@/components/lib/safe-url"

/** Info.publisher → SaveToHub 的 publisher 入参 (domain 缺失时不提供订阅项)。 */
function pubOf(info: Info): { domain: string; name?: string } | undefined {
  const domain = info.publisher?.domain
  return domain ? { domain, name: info.publisher?.name ?? undefined } : undefined
}

type ColumnMeta = { headerClassName?: string; cellClassName?: string }

// 各断点下隐藏次要列, 让窄屏只保留标题 + 操作。
const HIDE_SM: ColumnMeta = {
  headerClassName: "hidden sm:table-cell",
  cellClassName: "hidden sm:table-cell",
}
const HIDE_MD: ColumnMeta = {
  headerClassName: "hidden md:table-cell",
  cellClassName: "hidden md:table-cell",
}
const HIDE_LG: ColumnMeta = {
  headerClassName: "hidden lg:table-cell",
  cellClassName: "hidden lg:table-cell",
}
const HIDE_XL: ColumnMeta = {
  headerClassName: "hidden xl:table-cell",
  cellClassName: "hidden xl:table-cell",
}
// 时间列单元格: 右对齐 + 等宽数字, 不加 font-mono (TimeCell 含中文格式时避免字体跳变)。
const TIME_CELL = "text-right tabular-nums whitespace-nowrap"

/** 跳转到某条信息的「全面报道」分析页。 */
// /info/analysis 深链的唯一构造处 (本 app 内复用: columns 各处 + analysis/coverage)。
export const analysisLink = (url: string) => `/info/analysis?url=${encodeURIComponent(url)}`

/** 单条信息表格列 (实体页 / 发布者页 / 首页「最新」视图)。 */
export const getInfoColumns = (): ColumnDef<Info>[] => [
  {
    accessorKey: "title",
    header: "标题",
    cell: ({ row }) => <TitleCell title={row.original.title ?? ""} url={row.original.url} />,
  },
  {
    accessorKey: "labels",
    header: "实体",
    cell: ({ row }) => <EntityCell entities={row.original.labels} />,
    meta: HIDE_MD,
  },
  {
    accessorKey: "publisher",
    header: "发布者",
    cell: ({ row }) => <PublisherHoverCell publisher={row.original.publisher} />,
    meta: HIDE_SM,
  },
  {
    accessorKey: "collect_time",
    header: () => <div className="text-right">收录时间</div>,
    cell: ({ row }) => <TimeCell value={row.original.collect_time} />,
    meta: {
      headerClassName: HIDE_LG.headerClassName,
      cellClassName: `${HIDE_LG.cellClassName} ${TIME_CELL}`,
    },
  },
  {
    accessorKey: "publish_time",
    header: () => <div className="text-right">发布时间</div>,
    cell: ({ row }) => <TimeCell value={row.original.publish_time} />,
    meta: {
      headerClassName: HIDE_MD.headerClassName,
      cellClassName: `${HIDE_MD.cellClassName} ${TIME_CELL}`,
    },
  },
  {
    id: "actions",
    header: () => <span className="sr-only">操作</span>,
    cell: ({ row }) => (
      <div className="flex items-center justify-end gap-1">
        <Button
          className="h-auto p-0 text-xs"
          variant="link"
          onClick={() => window.open(analysisLink(row.original.url), "_blank")}
        >
          全面报道
        </Button>
        <SaveToHub
          variant="icon"
          bookmark={{ title: row.original.title ?? row.original.url, url: row.original.url }}
          publisher={pubOf(row.original)}
        />
      </div>
    ),
  },
]

/** 事件 (聚类后) 表格列 (/info 首页「热点」视图): 标题带来源数, 来源列汇总多家发布者。 */
export const getEventColumns = (): ColumnDef<InfoEvent>[] => [
  {
    accessorKey: "lead.title",
    header: "事件",
    cell: ({ row }) => {
      const event = row.original
      const title = event.lead.title ?? ""
      const url = event.lead.url
      const trigger = (
        <div className="flex max-w-[280px] flex-col items-start gap-1">
          <Button
            className="h-auto justify-start p-0 text-left"
            variant="link"
            onClick={() => openExternal(url)}
          >
            <span className="line-clamp-2 whitespace-normal">{title || url}</span>
          </Button>
          {event.source_count > 1 && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              {event.source_count} 个来源
            </span>
          )}
        </div>
      )
      if (title.length <= 40) return trigger
      return (
        <HoverCard>
          <HoverCardTrigger asChild>{trigger}</HoverCardTrigger>
          <HoverCardContent className="max-w-sm text-sm">{title}</HoverCardContent>
        </HoverCard>
      )
    },
  },
  {
    id: "labels",
    header: "实体",
    cell: ({ row }) => <EntityCell entities={row.original.lead.labels} />,
    meta: HIDE_MD,
  },
  {
    id: "publishers",
    header: "来源",
    cell: ({ row }) => {
      const { lead, related, source_count } = row.original
      if (source_count <= 1) {
        return <PublisherHoverCell publisher={lead.publisher} />
      }
      const names = [lead, ...related]
        .map((i) => i.publisher?.name || i.publisher?.domain)
        .filter(Boolean)
      const unique = [...new Set(names)]
      return (
        <HoverCard>
          <HoverCardTrigger asChild>
            <Button className="h-auto p-0 text-xs" variant="link">
              {unique.slice(0, 2).join("、")}
              {unique.length > 2 ? ` 等 ${source_count} 家` : ""}
            </Button>
          </HoverCardTrigger>
          <HoverCardContent className="max-w-xs space-y-1 text-xs">
            {unique.map((name) => (
              <div key={name}>{name}</div>
            ))}
          </HoverCardContent>
        </HoverCard>
      )
    },
    meta: HIDE_SM,
  },
  {
    accessorKey: "lead.collect_time",
    header: () => <div className="text-right">收录时间</div>,
    cell: ({ row }) => <TimeCell value={row.original.lead.collect_time} />,
    meta: {
      headerClassName: HIDE_LG.headerClassName,
      cellClassName: `${HIDE_LG.cellClassName} ${TIME_CELL}`,
    },
  },
  {
    accessorKey: "lead.publish_time",
    header: () => <div className="text-right">发布时间</div>,
    cell: ({ row }) => <TimeCell value={row.original.lead.publish_time} />,
    meta: {
      headerClassName: HIDE_MD.headerClassName,
      cellClassName: `${HIDE_MD.cellClassName} ${TIME_CELL}`,
    },
  },
  {
    id: "actions",
    header: () => <span className="sr-only">操作</span>,
    cell: ({ row }) => {
      const lead = row.original.lead
      return (
        <div className="flex items-center justify-end gap-1">
          <Button
            className="h-auto p-0 text-xs"
            variant="link"
            onClick={() => window.open(analysisLink(lead.url), "_blank")}
          >
            全面报道
          </Button>
          <SaveToHub
            variant="icon"
            bookmark={{ title: lead.title ?? lead.url, url: lead.url }}
            publisher={pubOf(lead)}
          />
        </div>
      )
    },
  },
]

/** 发布者 (分组) 表格列 (/info 首页「发布者」视图): 一行一个发布者, 按最近更新倒序。 */
export const getPublisherGroupColumns = (): ColumnDef<PublisherGroup>[] => [
  {
    id: "publisher",
    header: "发布者",
    cell: ({ row }) => {
      const publisher = row.original.publisher
      return (
        <div className="flex flex-col items-start gap-0.5">
          <PublisherHoverCell publisher={publisher} />
          {publisher.name && (
            <span className="text-xs text-muted-foreground">{publisher.domain}</span>
          )}
        </div>
      )
    },
  },
  {
    id: "latest",
    header: "最新信息",
    cell: ({ row }) => (
      <TitleCell title={row.original.latest.title ?? ""} url={row.original.latest.url} />
    ),
  },
  {
    id: "labels",
    header: "实体",
    cell: ({ row }) => <EntityCell entities={row.original.latest.labels} />,
    meta: HIDE_MD,
  },
  {
    id: "count",
    header: () => <div className="text-right">条数</div>,
    cell: ({ row }) => (
      <div className="text-right text-xs font-medium tabular-nums">{row.original.count}</div>
    ),
    meta: HIDE_SM,
  },
  {
    id: "latest_time",
    header: () => <div className="text-right">最近更新</div>,
    cell: ({ row }) => <TimeCell value={row.original.latest.collect_time} />,
    meta: { cellClassName: TIME_CELL },
  },
  {
    id: "actions",
    header: () => <span className="sr-only">操作</span>,
    cell: ({ row }) => {
      const { latest, publisher } = row.original
      return (
        <div className="flex items-center justify-end gap-1">
          <Button
            className="h-auto p-0 text-xs"
            variant="link"
            onClick={() =>
              window.open(
                `/info/publisher?domain=${encodeURIComponent(publisher.domain)}`,
                "_blank",
              )
            }
          >
            发布者页
          </Button>
          <SaveToHub
            variant="icon"
            bookmark={{ title: latest.title ?? latest.url, url: latest.url }}
            publisher={pubOf(latest)}
          />
        </div>
      )
    },
  },
]

/** 搜索结果表格列 (/info/search): 行操作菜单 = 收入中枢 (收藏 / 订阅 / 原文 / 全面报道)。 */
export const getSearchColumns = (): ColumnDef<Info>[] => [
  {
    accessorKey: "title",
    header: "标题",
    cell: ({ row }) => <TitleCell title={row.original.title ?? ""} url={row.original.url} />,
  },
  {
    accessorKey: "labels",
    header: "实体",
    cell: ({ row }) => <EntityCell entities={row.original.labels} />,
    meta: HIDE_MD,
  },
  {
    accessorKey: "publisher",
    header: "发布者",
    cell: ({ row }) => (
      <div className="text-xs font-medium">{row.original.publisher?.domain ?? "-"}</div>
    ),
    meta: HIDE_SM,
  },
  {
    accessorKey: "publish_time",
    header: () => <div className="text-right">发布时间</div>,
    cell: ({ row }) => <TimeCell value={row.original.publish_time} />,
    meta: {
      headerClassName: HIDE_MD.headerClassName,
      cellClassName: `${HIDE_MD.cellClassName} ${TIME_CELL}`,
    },
  },
  {
    accessorKey: "collect_time",
    header: () => <div className="text-right">收录时间</div>,
    cell: ({ row }) => <TimeCell value={row.original.collect_time} />,
    meta: {
      headerClassName: HIDE_XL.headerClassName,
      cellClassName: `${HIDE_XL.cellClassName} ${TIME_CELL}`,
    },
  },
  {
    id: "actions",
    header: () => <span className="sr-only">操作</span>,
    cell: ({ row }) => (
      <div className="flex justify-end">
        <SaveToHub
          variant="icon"
          bookmark={{ title: row.original.title ?? row.original.url, url: row.original.url }}
          publisher={pubOf(row.original)}
          openUrl={row.original.url}
          analysisUrl={analysisLink(row.original.url)}
        />
      </div>
    ),
  },
]
