"use client"

import React, { Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { fetchLatestInfo, getEntityDetail } from "../data"
import { getInfoColumns } from "../columns"
import { DataTable } from "../table"
import { EntityDetail, Info, NameEntity } from "../model"
import { entityLink, EntityEntryLinks } from "../cells"
import { SubscribeButton } from "@/components/feeders"
import { entityLabelText } from "@/components/lib/ner-labels"
import { formatTimestamp } from "@/components/lib/format"
import { useApiResult } from "@/components/lib/use-api-result"

/**
 * 周趋势迷你条形图: 纯 div 实现 (不为一个小图引图表库), 高度按各周 count 归一化,
 * hover title 给出周起始日期 + 条数。weekly 后端已按 period 升序返回。
 */
function WeeklyTrend({ weekly }: { weekly: EntityDetail["weekly"] }) {
  if (!weekly.length) return null
  const max = Math.max(...weekly.map((w) => w.count), 1)
  return (
    <div className="flex h-10 items-end gap-0.5">
      {weekly.map((w) => (
        <div
          key={w.period}
          title={`${new Date(w.period).toLocaleDateString("zh-CN")} 起一周 · ${w.count} 条`}
          className="w-2 rounded-sm bg-primary/50 hover:bg-primary"
          // 最矮也留 8% 高度, 否则 count=1 的周在 max 很大时缩成一条看不见的线
          style={{ height: `${Math.max(8, Math.round((w.count / max) * 100))}%` }}
        />
      ))}
    </div>
  )
}

/** 共现实体: 可点击 Badge 跳实体页, 有词条的用实色突出 (更可能是有效实体)。 */
function CoEntities({ items }: { items: EntityDetail["co_entities"] }) {
  if (!items.length) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((e) => (
        <Badge
          key={`${e.label}-${e.name}`}
          variant={e.has_entry ? "secondary" : "outline"}
          title={`${entityLabelText(e.label)} · 共同出现 ${e.count} 条`}
          className="cursor-pointer gap-1 font-normal hover:underline"
          onClick={() => window.open(entityLink(e.label, e.name), "_blank")}
        >
          <span className={e.has_entry ? "" : "text-muted-foreground"}>{e.name}</span>
          <span className="text-[10px] text-muted-foreground">×{e.count}</span>
        </Badge>
      ))}
    </div>
  )
}

// 实体页 (查询参数路由 /info/entity?label=&name= , 兼容静态导出)。
function EntityView() {
  const sp = useSearchParams()
  const label = sp.get("label") ?? ""
  const name = sp.get("name") ?? ""

  const columns = getInfoColumns()
  const { data, loading, error, reload } = useApiResult<Info[]>(
    () => fetchLatestInfo({ entity_label_name: [[label, name]] }),
    [],
    [label, name],
  )

  // 实体详情与信息列表并行拉取 (两个独立请求互不阻塞); 详情失败仅降级隐藏统计区, 不影响列表主链路。
  const [detail, setDetail] = React.useState<EntityDetail | null>(null)
  React.useEffect(() => {
    let active = true
    async function run() {
      // 在 async 函数内置位 (清掉上一实体的详情), 避免 effect 体内同步 setState 的级联渲染 lint
      setDetail(null)
      const d = await getEntityDetail(label, name)
      if (active) setDetail(d)
    }
    run()
    return () => {
      active = false
    }
  }, [label, name])

  // 该实体的百科词条链接: 优先用详情接口的跨周聚合结果 (比单页列表扫描更全),
  // 详情拿不到时回退到从已拉取的 Info 列表里取首个匹配 (label,name) 且带链接的实体。
  const entry = React.useMemo<NameEntity | undefined>(() => {
    if (detail && (detail.baike_url || detail.wikipedia_url)) {
      return {
        label,
        name,
        period: 0,
        has_entry: detail.has_entry,
        baike_url: detail.baike_url,
        wikipedia_url: detail.wikipedia_url,
      }
    }
    for (const info of data) {
      const match = info.labels?.find((e) => e.label === label && e.name === name)
      if (match && (match.baike_url || match.wikipedia_url)) return match
    }
    return undefined
  }, [detail, data, label, name])

  // 空态: 详情确认无提及且列表也为空 (排除加载中/出错), 此时不再渲染空表格。
  const showEmpty =
    !loading && !error && detail !== null && detail.mention_count === 0 && data.length === 0

  return (
    <main className="m-2 sm:m-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="flex min-w-0 flex-wrap items-center gap-2 text-base sm:text-lg">
            <span className="min-w-0 break-words">
              实体: <span className="text-muted-foreground">{entityLabelText(label)}</span> · {name}
            </span>
            {entry && (
              <span className="flex items-center gap-1 text-xs font-normal">
                <EntityEntryLinks entity={entry} />
              </span>
            )}
          </CardTitle>
          <SubscribeButton
            sub={{
              type: "entity",
              key: `${label}/${name}`,
              title: name,
              entityLabel: label,
              entityName: name,
            }}
          />
        </CardHeader>
        <CardContent className="space-y-4">
          {detail && detail.mention_count > 0 && (
            <div className="space-y-3 rounded-md border bg-muted/30 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">提及 {detail.mention_count} 条</span>
                <span>首次 {formatTimestamp(detail.first_seen)}</span>
                <span>最近 {formatTimestamp(detail.last_seen)}</span>
              </div>
              {detail.weekly.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">周提及趋势</div>
                  <WeeklyTrend weekly={detail.weekly} />
                </div>
              )}
              {detail.co_entities.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">共现实体</div>
                  <CoEntities items={detail.co_entities} />
                </div>
              )}
            </div>
          )}
          {showEmpty ? (
            <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
              知识图谱中暂无「{name}」的提及记录
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={data}
              loading={loading}
              error={error}
              onRetry={reload}
            />
          )}
        </CardContent>
      </Card>
    </main>
  )
}

export default function EntityPage() {
  return (
    <Suspense>
      <EntityView />
    </Suspense>
  )
}
