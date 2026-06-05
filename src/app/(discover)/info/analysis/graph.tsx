"use client"

import { useEffect, useMemo, useRef } from "react"
import { Graph, type GraphData } from "@antv/g6"
import { NER_LABEL_TEXT } from "@/lib/ner-labels"
import { Info, NameEntity } from "../model"

/**
 * 关系图谱 (AntV G6): 把「全面报道」的聚类依据可视化 —— 本文与各关联报道通过 *共享命名实体* 相连,
 * 实体成为枢纽节点, 一眼看出「这些报道凭哪些人物/地区/组织被判为同一事件」。
 *
 * 结构: 本文 + 各关联报道 (文章节点) ── 提及 ──> 命名实体 (枢纽节点)。
 * 只画本文持有的实体集 (聚类基准), 关联报道仅连到与本文 *共享* 的实体, 避免噪声。
 */

type Props = { info: Info; related: Info[] }

// 命名实体 label → 中文分类 (文案复用全站统一口径; 此处分类还用于映射节点填充色)
const OTHER_ENTITY = "其他实体"

// 分类 → 颜色 (节点填充 + 图例一致)
const CATEGORY_COLOR: Record<string, string> = {
  本文: "#ef4444",
  关联报道: "#3b82f6",
  人物: "#f59e0b",
  地区: "#10b981",
  组织: "#8b5cf6",
  时间: "#06b6d4",
  产品: "#ec4899",
  事件: "#eab308",
  [OTHER_ENTITY]: "#94a3b8",
}

const entityKey = (e: NameEntity) => `${e.label}:${e.name}`
const entityCat = (label: string) => NER_LABEL_TEXT[label] ?? OTHER_ENTITY
const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s)

type Built = { data: GraphData; categories: string[] }

function buildGraph(info: Info, related: Info[]): Built {
  const nodes: NonNullable<GraphData["nodes"]> = []
  const edges: NonNullable<GraphData["edges"]> = []
  const seen = new Set<string>()
  const degree = new Map<string, number>()
  const present = new Set<string>()
  const bump = (id: string) => degree.set(id, (degree.get(id) ?? 0) + 1)

  // 本文 (中心)
  const srcId = `info:${info.url}`
  present.add("本文")
  nodes.push({
    id: srcId,
    data: { category: "本文", tooltip: info.title || info.url },
    style: {
      size: 48,
      fill: CATEGORY_COLOR["本文"],
      labelText: truncate(info.title || info.url, 16),
      labelPlacement: "bottom",
      labelFontSize: 12,
      labelFontWeight: 600,
      labelFill: "#1f2937",
    },
  })
  seen.add(srcId)

  // 本文的实体集 = 聚类基准 + 连接枢纽
  const sourceEntities = new Map<string, NameEntity>()
  for (const e of info.labels ?? []) sourceEntities.set(entityKey(e), e)
  for (const [key, e] of sourceEntities) {
    const cat = entityCat(e.label)
    present.add(cat)
    nodes.push({
      id: key,
      data: { category: cat, tooltip: `${cat} · ${e.name}` },
      style: {
        size: 22,
        fill: CATEGORY_COLOR[cat],
        labelText: truncate(e.name, 10),
        labelPlacement: "bottom",
        labelFontSize: 11,
        labelFill: "#475569",
      },
    })
    seen.add(key)
    edges.push({ source: srcId, target: key, data: { tooltip: "提及" } })
    bump(key)
  }

  // 关联报道 + 与共享实体的连边
  related.forEach((r, i) => {
    const rid = `info:${r.url}`
    if (seen.has(rid)) return
    const shared = (r.labels ?? []).filter((e) => sourceEntities.has(entityKey(e)))
    present.add("关联报道")
    nodes.push({
      id: rid,
      data: {
        category: "关联报道",
        // 报道标题较长, 不常驻标签, 仅 hover tooltip 展示
        tooltip: `${r.publisher?.name || r.publisher?.domain || "未知来源"} · ${r.title || r.url}`,
      },
      style: { size: 28, fill: CATEGORY_COLOR["关联报道"] },
    })
    seen.add(rid)
    if (shared.length) {
      for (const e of shared) {
        edges.push({ source: rid, target: entityKey(e), data: { tooltip: "提及" } })
        bump(entityKey(e))
      }
    } else {
      // 兜底: 后端理论上已保证有共享实体, 万一没有则直连本文避免漂浮
      edges.push({ source: rid, target: srcId, id: `fallback-${i}`, data: { tooltip: "相关" } })
    }
  })

  // 枢纽实体被越多报道提及越大 (共识焦点)
  for (const node of nodes) {
    if (node.data?.category && node.data.category !== "本文" && node.data.category !== "关联报道") {
      const d = degree.get(String(node.id)) ?? 1
      node.style = { ...node.style, size: 18 + Math.min(d, 8) * 4 }
    }
  }

  // 图例只列实际出现的分类, 顺序固定
  const order = ["本文", "关联报道", "人物", "地区", "组织", "时间", "产品", "事件", OTHER_ENTITY]
  return { data: { nodes, edges }, categories: order.filter((c) => present.has(c)) }
}

const KnowledgeGraph = ({ info, related }: Props) => {
  const chartRef = useRef<HTMLDivElement | null>(null)
  const { data, categories } = useMemo(() => buildGraph(info, related), [info, related])

  useEffect(() => {
    if (!chartRef.current) return
    const graph = new Graph({
      container: chartRef.current,
      autoResize: true,
      data,
      node: {
        style: { labelBackground: true, labelBackgroundFill: "#fff", labelBackgroundOpacity: 0.65 },
      },
      edge: { style: { stroke: "#cbd5e1", lineWidth: 1, endArrow: false, opacity: 0.7 } },
      layout: {
        type: "force",
        preventOverlap: true,
        nodeSize: 48,
        linkDistance: 140,
        gravity: 6,
        factor: 2,
      },
      behaviors: [
        "zoom-canvas",
        "drag-canvas",
        "drag-element",
        { type: "hover-activate", degree: 1 },
      ],
      plugins: [
        {
          type: "tooltip",
          trigger: "hover",
          getContent: async (_evt: unknown, items: { data?: { tooltip?: string } }[]) =>
            `<div style="max-width:280px;font-size:12px;line-height:1.5">${items?.[0]?.data?.tooltip ?? ""}</div>`,
        },
      ],
    })
    graph.render()
    return () => {
      graph.destroy()
    }
  }, [data])

  return (
    <div className="flex flex-col gap-2">
      <div ref={chartRef} className="h-[400px] w-full sm:h-[520px] lg:h-[600px]" />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-muted-foreground">
        {categories.map((c) => (
          <span key={c} className="inline-flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: CATEGORY_COLOR[c] }}
            />
            {c}
          </span>
        ))}
      </div>
    </div>
  )
}

export default KnowledgeGraph
