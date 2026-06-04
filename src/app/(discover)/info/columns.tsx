import { ColumnDef } from "@tanstack/react-table"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { MoreHorizontal } from "lucide-react"
import { Info, InfoEvent } from "./model"
import { EntityCell, PublisherHoverCell, TimeCell, TitleCell } from "./cells"

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

/** 跳转到某条信息的「全面报道」分析页。 */
const analysisLink = (url: string) => `/info/analysis?url=${encodeURIComponent(url)}`

/** 单条信息表格列 (实体页 / 发布者页)。 */
export const getInfoColumns = (): ColumnDef<Info>[] => [
  {
    accessorKey: "title",
    header: "标题",
    cell: ({ row }) => <TitleCell title={row.original.title ?? ""} url={row.original.url} />,
  },
  {
    accessorKey: "labels",
    header: "命名实体",
    cell: ({ row }) => <EntityCell entities={row.original.labels} />,
    meta: HIDE_MD,
  },
  {
    accessorKey: "publisher",
    header: "发布网站",
    cell: ({ row }) => <PublisherHoverCell publisher={row.original.publisher} />,
    meta: HIDE_SM,
  },
  {
    accessorKey: "collect_time",
    header: () => <div className="text-right">采集时间</div>,
    cell: ({ row }) => <TimeCell value={row.original.collect_time} />,
    meta: HIDE_LG,
  },
  {
    accessorKey: "publish_time",
    header: () => <div className="text-right">发布时间</div>,
    cell: ({ row }) => <TimeCell value={row.original.publish_time} />,
    meta: HIDE_MD,
  },
  {
    id: "actions",
    header: () => <span className="sr-only">详情</span>,
    cell: ({ row }) => (
      <Button
        className="h-auto p-0 text-xs"
        variant="link"
        onClick={() => window.open(analysisLink(row.original.url), "_blank")}
      >
        全面报道
      </Button>
    ),
  },
]

/** 事件 (聚类后) 表格列 (/info 首页): 标题带来源数, 来源列汇总多家发布者。 */
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
            onClick={() => window.open(url, "_blank")}
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
    header: "命名实体",
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
    header: () => <div className="text-right">采集时间</div>,
    cell: ({ row }) => <TimeCell value={row.original.lead.collect_time} />,
    meta: HIDE_LG,
  },
  {
    accessorKey: "lead.publish_time",
    header: () => <div className="text-right">发布时间</div>,
    cell: ({ row }) => <TimeCell value={row.original.lead.publish_time} />,
    meta: HIDE_MD,
  },
  {
    id: "actions",
    header: () => <span className="sr-only">详情</span>,
    cell: ({ row }) => (
      <Button
        className="h-auto p-0 text-xs"
        variant="link"
        onClick={() => window.open(analysisLink(row.original.lead.url), "_blank")}
      >
        全面报道
      </Button>
    ),
  },
]

/** 搜索结果表格列 (/info/search): 发布者只显示域名, 行操作菜单为待实现占位。 */
export const getSearchColumns = (): ColumnDef<Info>[] => [
  {
    accessorKey: "title",
    header: "标题",
    cell: ({ row }) => <TitleCell title={row.original.title ?? ""} url={row.original.url} />,
  },
  {
    accessorKey: "labels",
    header: "命名实体",
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
    meta: HIDE_MD,
  },
  {
    accessorKey: "collect_time",
    header: () => <div className="text-right">采集时间</div>,
    cell: ({ row }) => <TimeCell value={row.original.collect_time} />,
    meta: HIDE_XL,
  },
  {
    id: "actions",
    header: () => <span className="sr-only">操作</span>,
    // TODO: 行级操作 (分析/原文/分类/主题/关键词/命名实体) 尚未接线 —— 暂全部 disabled。
    //   原实现靠 e.target.innerText 派发, 改文案即断, 接线时应给每项绑定具体 onSelect, 勿依赖 innerText。
    cell: () => (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-8 w-8 p-0">
            <span className="sr-only">打开操作菜单</span>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled>分析</DropdownMenuItem>
          <DropdownMenuItem disabled>原文</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled>分类</DropdownMenuItem>
          <DropdownMenuItem disabled>主题</DropdownMenuItem>
          <DropdownMenuItem disabled>关键词</DropdownMenuItem>
          <DropdownMenuItem disabled>命名实体</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  },
]
