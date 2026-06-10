"use client"

import * as React from "react"
import { Badge } from "@/components/ui/badge"
import { entityLabelText } from "@/lib/ner-labels"
import { useApiResult } from "@/lib/use-api-result"
import { fetchEntityStats } from "./action"
import { entityLink } from "./cells"
import { EntityStats } from "./model"

/** 榜单展示条数: 五类合并后取前 12, 一行 Badge 能装下又有信息量。 */
const TOP_N = 12
/** 统计窗口: 近 24 小时 (与「热门」的直觉口径一致)。 */
const STAT_HOURS = 24

/** EntityStats 的五类 key → NER label (entityLink / entityLabelText 用大写 label)。 */
const STATS_KEY_LABEL: [keyof EntityStats, string][] = [
  ["per", "PER"],
  ["loc", "LOC"],
  ["org", "ORG"],
  ["product", "PRODUCT"],
  ["event", "EVENT"],
]

/** 五类 `{name: count}` 合并 → 按 count 倒序取前 TOP_N。 */
function mergeTop(stats: EntityStats): { label: string; name: string; count: number }[] {
  const merged: { label: string; name: string; count: number }[] = []
  for (const [key, label] of STATS_KEY_LABEL) {
    for (const [name, count] of Object.entries(stats[key] ?? {})) {
      merged.push({ label, name, count })
    }
  }
  return merged.sort((a, b) => b.count - a.count).slice(0, TOP_N)
}

/**
 * /info 首页「热门实体」榜: 近 24 小时五类实体频次合并取 top, 点击进实体页。
 * 增强型区块 —— 无数据 / 加载中 / 出错时整体隐藏 (return null), 不打扰事件流主链路。
 */
export default function HotEntities() {
  // silent: 失败时整块隐藏, 不 toast (否则与 InfoList 主链路的报错叠成双 toast)
  const { data, loading, error } = useApiResult<EntityStats | null>(
    () => fetchEntityStats(STAT_HOURS),
    null,
    [],
    { silent: true },
  )

  const top = React.useMemo(() => (data ? mergeTop(data) : []), [data])
  if (loading || error || top.length === 0) return null

  return (
    <section className="space-y-2 px-2 sm:px-4">
      <h2 className="text-sm font-medium text-muted-foreground">热门实体 (近 24 小时)</h2>
      <div className="flex flex-wrap gap-1.5">
        {top.map((e) => (
          <Badge
            key={`${e.label}-${e.name}`}
            variant="secondary"
            title={`${entityLabelText(e.label)} · 提及 ${e.count} 条`}
            className="cursor-pointer gap-1 font-normal hover:underline"
            onClick={() => window.open(entityLink(e.label, e.name), "_blank")}
          >
            <span>{e.name}</span>
            <span className="text-[10px] text-muted-foreground">×{e.count}</span>
          </Badge>
        ))}
      </div>
    </section>
  )
}
