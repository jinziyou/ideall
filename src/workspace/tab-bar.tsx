"use client"

// 顶部标签条: Chrome 式 flex 均分 + 最小/最大宽度; 窄时隐去类型徽标, 溢出横向滚动 + 「更多」。
// 全键盘可达: role=tab, Enter/Space 激活, Delete 关闭, Ctrl+Shift+←/→ 重排。

import * as React from "react"
import { ChevronDown, X } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu"
import { useTabs, useActiveId, setActiveTab, closeTab, reorderTabs } from "./store"
import type { Tab } from "./types"
import { tabViewType, TAB_VIEW_LABEL } from "./tab-view-type"
import { MODULE_DOT } from "./module-dot"

/** Chrome 近似: 最小约 favicon 宽, 最大 ~240px, 中间 flex 均分收缩。 */
const TAB_MIN_PX = 48
const TAB_MAX_PX = 240

function TabItem({
  tab: t,
  index: i,
  tabs,
  active,
  dragIdRef,
  tabRef,
}: {
  tab: Tab
  index: number
  tabs: Tab[]
  active: boolean
  dragIdRef: React.MutableRefObject<string | null>
  tabRef: (el: HTMLDivElement | null) => void
}) {
  return (
    <div
      ref={tabRef}
      role="tab"
      tabIndex={active ? 0 : -1}
      aria-selected={active}
      draggable
      onDragStart={() => {
        dragIdRef.current = t.id
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={() => {
        if (dragIdRef.current) reorderTabs(dragIdRef.current, t.id)
        dragIdRef.current = null
      }}
      onClick={() => setActiveTab(t.id)}
      onKeyDown={(e) => {
        const el = e.currentTarget
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          setActiveTab(t.id)
        } else if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault()
          closeTab(t.id)
        } else if (e.ctrlKey && e.shiftKey && e.key === "ArrowLeft" && i > 0) {
          e.preventDefault()
          reorderTabs(t.id, tabs[i - 1].id)
        } else if (e.ctrlKey && e.shiftKey && e.key === "ArrowRight" && i < tabs.length - 1) {
          e.preventDefault()
          reorderTabs(t.id, tabs[i + 1].id)
        } else if (e.key === "ArrowLeft") {
          e.preventDefault()
          ;(el.previousElementSibling as HTMLElement | null)?.focus()
        } else if (e.key === "ArrowRight") {
          e.preventDefault()
          ;(el.nextElementSibling as HTMLElement | null)?.focus()
        } else if (e.key === "Home") {
          e.preventDefault()
          ;(el.parentElement?.firstElementChild as HTMLElement | null)?.focus()
        } else if (e.key === "End") {
          e.preventDefault()
          ;(el.parentElement?.lastElementChild as HTMLElement | null)?.focus()
        }
      }}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault()
          closeTab(t.id)
        }
      }}
      style={{ minWidth: TAB_MIN_PX, maxWidth: TAB_MAX_PX }}
      className={cn(
        "@container/tab group/tab relative flex h-full min-w-0 flex-[1_1_0] basis-0 cursor-pointer select-none items-center gap-1.5 px-2 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        active
          ? "z-[1] bg-card text-foreground shadow-[inset_0_-1px_0_0_hsl(var(--card))]"
          : "border-r border-border/40 text-muted-foreground hover:bg-accent/40 hover:text-foreground",
      )}
    >
      <span className={cn("h-2 w-2 shrink-0 rounded-full", MODULE_DOT[t.module])} />
      <span className="hidden shrink-0 rounded bg-muted px-1 py-px text-[10px] font-medium text-muted-foreground @[96px]/tab:inline">
        {TAB_VIEW_LABEL[tabViewType(t)]}
      </span>
      <span className="min-w-0 flex-1 truncate tab-when-narrow-hidden">{t.title}</span>
      <button
        type="button"
        title="关闭"
        aria-label={`关闭 ${t.title}`}
        onClick={(e) => {
          e.stopPropagation()
          closeTab(t.id)
        }}
        className={cn(
          "ml-auto flex h-4 w-4 shrink-0 items-center justify-center rounded opacity-0 outline-none transition-opacity hover:bg-accent focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover/tab:opacity-70 tab-when-narrow-hidden",
          active && "opacity-60 group-hover/tab:opacity-100",
        )}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

export default function TabBar() {
  const tabs = useTabs()
  const activeId = useActiveId()
  const dragIdRef = React.useRef<string | null>(null)
  const tablistRef = React.useRef<HTMLDivElement>(null)
  const tabRefs = React.useRef(new Map<string, HTMLDivElement>())
  const [overflowing, setOverflowing] = React.useState(false)

  const checkOverflow = React.useCallback(() => {
    const el = tablistRef.current
    if (!el) return
    setOverflowing(el.scrollWidth > el.clientWidth + 1)
  }, [])

  React.useEffect(() => {
    checkOverflow()
    const el = tablistRef.current
    if (!el) return
    const ro = new ResizeObserver(checkOverflow)
    ro.observe(el)
    return () => ro.disconnect()
  }, [tabs.length, checkOverflow, tabs])

  React.useEffect(() => {
    if (!activeId) return
    const el = tabRefs.current.get(activeId)
    el?.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" })
  }, [activeId, tabs.length])

  return (
    <div className="hidden h-9 shrink-0 items-stretch border-b bg-secondary/30 md:flex">
      <div
        ref={tablistRef}
        role="tablist"
        onScroll={checkOverflow}
        className="flex min-w-0 flex-1 items-stretch overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.length === 0 ? (
          <span className="flex items-center px-3 text-xs text-muted-foreground">
            从左侧选择一个面板打开
          </span>
        ) : (
          tabs.map((t, i) => (
            <TabItem
              key={t.id}
              tab={t}
              index={i}
              tabs={tabs}
              active={t.id === activeId}
              dragIdRef={dragIdRef}
              tabRef={(el) => {
                if (el) tabRefs.current.set(t.id, el)
                else tabRefs.current.delete(t.id)
              }}
            />
          ))
        )}
      </div>

      {tabs.length > 0 && overflowing && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title="全部标签"
              aria-label="全部标签"
              className="flex h-full shrink-0 items-center gap-0.5 border-l border-border/40 px-2 text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronDown className="h-4 w-4" />
              <span className="text-[11px] tabular-nums">{tabs.length}</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-[60vh] w-64 overflow-y-auto">
            {tabs.map((t) => (
              <DropdownMenuItem
                key={t.id}
                onSelect={() => setActiveTab(t.id)}
                className={cn("gap-2", t.id === activeId && "bg-accent/60 font-medium")}
              >
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", MODULE_DOT[t.module])} />
                <span className="shrink-0 rounded bg-muted px-1 py-px text-[10px] font-medium text-muted-foreground">
                  {TAB_VIEW_LABEL[tabViewType(t)]}
                </span>
                <span className="flex-1 truncate">{t.title}</span>
                <button
                  type="button"
                  title="关闭"
                  aria-label={`关闭 ${t.title}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    closeTab(t.id)
                  }}
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
