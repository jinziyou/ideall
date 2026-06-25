import Link from "next/link"
import { ColumnDef } from "@tanstack/react-table"
import { Button } from "@/ui/button"
import { Info } from "./model"
import { EntityCell, PublisherHoverCell, TimeCell, TitleCell } from "./cells"
import { SaveToMine } from "@/shared/feeders"

/** Info.publisher → SaveToMine 的 publisher 入参 (domain 缺失时不提供订阅项)。 */
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
        <Button asChild className="h-auto p-0 text-xs" variant="link">
          <Link href={analysisLink(row.original.url)}>全面报道</Link>
        </Button>
        <SaveToMine
          variant="icon"
          bookmark={{ title: row.original.title ?? row.original.url, url: row.original.url }}
          publisher={pubOf(row.original)}
        />
      </div>
    ),
  },
]

/** 搜索结果表格列 (/info/search): 行操作菜单 = 收入「我的」(收藏 / 订阅 / 原文 / 全面报道)。 */
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
        <SaveToMine
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
