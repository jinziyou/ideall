"use client"

// 「我的」侧栏 (一切皆文件 · places): 顶部特殊入口 (概览/发布) + 根命名空间切换 + 该命名空间的跨 kind 文件树。
// 点文件树节点: 有查看器的 kind (note) 开实体标签; 暂无查看器的落到该命名空间管理器 (不出现"暂不支持"空标签)。
import * as React from "react"
import { LayoutDashboard, Megaphone } from "lucide-react"
import { cn } from "@/lib/utils"
import type { TabDescriptor } from "./types"
import { PLACES, placeById } from "./places"
import { NodeTree } from "./node-tree"
import { resolveViewer } from "./node-viewers"
import type { NodeRef } from "./node-ref"
import { openNodeTab, openTab, setActivePlace, tabKey, useActiveId, useActivePlace } from "./store"

const OVERVIEW: TabDescriptor = {
  kind: "home-overview",
  module: "home",
  title: "概览",
  path: "/home",
}
const PUBLICATIONS: TabDescriptor = {
  kind: "home-publications",
  module: "home",
  title: "发布",
  path: "/home/publications",
}

export default function PlacesSidebar() {
  const activePlace = useActivePlace()
  const activeId = useActiveId()
  const place = placeById(activePlace)

  const handleOpen = React.useCallback(
    (ref: NodeRef, title: string) => {
      // 有查看器 → 开实体标签; 无查看器但有管理器 → 落管理器 (避"暂不支持"空标签); 都无 → 仍开实体标签兜底。
      if (resolveViewer(ref.kind)) openNodeTab(ref, title)
      else if (place.manager) openTab(place.manager)
      else openNodeTab(ref, title)
    },
    [place],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 顶部特殊入口: 概览 / 发布 (非节点命名空间) */}
      <nav className="flex flex-col gap-0.5 px-2 pt-2">
        <TopEntry d={OVERVIEW} icon={LayoutDashboard} label="概览" activeId={activeId} />
        <TopEntry d={PUBLICATIONS} icon={Megaphone} label="发布" activeId={activeId} />
      </nav>

      {/* places 切换: 笔记 / 书签 / 资源 / 关注 / 对话 (根命名空间; 多项换行) */}
      <div className="mt-2 flex flex-wrap gap-1 px-2" role="tablist" aria-label="根命名空间">
        {PLACES.map((p) => {
          const Icon = p.icon
          const active = p.id === activePlace
          return (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActivePlace(p.id)}
              title={p.label}
              className={cn(
                "flex items-center gap-1 rounded-shell px-2 py-1.5 text-xs transition-colors",
                active
                  ? "bg-primary/10 font-medium text-primary"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{p.label}</span>
            </button>
          )
        })}
      </div>

      {/* 该命名空间的跨 kind 文件树; key=place.id: 切换 place 重挂 → 回到加载态并清空展开集。 */}
      <div className="mt-1 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <NodeTree
          key={place.id}
          kinds={place.kinds}
          onOpen={handleOpen}
          emptyHint={place.emptyHint}
        />
      </div>

      {/* 打开该命名空间的管理器 (对话无独立管理器, 不渲染) */}
      {place.manager && (
        <div className="shrink-0 border-t p-2">
          <button
            type="button"
            onClick={() => openTab(place.manager!)}
            className="w-full rounded-shell px-2.5 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
          >
            打开{place.label}管理器
          </button>
        </div>
      )}
    </div>
  )
}

function TopEntry({
  d,
  icon: Icon,
  label,
  activeId,
}: {
  d: TabDescriptor
  icon: React.ComponentType<{ className?: string }>
  label: string
  activeId: string | null
}) {
  const active = activeId === tabKey(d)
  return (
    <button
      type="button"
      onClick={() => openTab(d)}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-shell px-2.5 py-2 text-sm transition-colors",
        active
          ? "bg-primary/10 font-medium text-primary"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="flex-1 truncate text-left">{label}</span>
    </button>
  )
}
