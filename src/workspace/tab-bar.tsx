"use client"

// 顶部标签条: 固定宽度标签 + 横向滚动; 右侧留白区右键管理; 溢出时显示「更多」。
// 全键盘可达: role=tab, Enter/Space 激活, Delete 关闭, Ctrl+Shift+←/→ 重排。

import * as React from "react"
import { ChevronDown, LayoutList, X } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu"
import { useTabs, useActiveId, setActiveTab, closeTab, closeAllTabs, closeOtherTabs, reorderTabs } from "./store"
import type { Tab } from "./types"
import { tabViewType, TAB_VIEW_LABEL } from "./tab-view-type"
import { MODULE_DOT } from "./module-dot"

/** Chrome 近似: 最小约 favicon 宽, 最大 ~240px, 中间 flex 均分收缩。 */
const TAB_MIN_PX = 48
const TAB_MAX_PX = 240
/** 标签列表右侧留白 (点击/右键打开标签管理菜单)。 */
const TAB_TAIL_MIN_PX = 112

function TabBarTailMenu({
  tabs,
  activeId,
}: {
  tabs: Tab[]
  activeId: string | null
}) {
  const [open, setOpen] = React.useState(false)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="标签管理"
          aria-label="标签管理"
          className={cn(
            "flex h-full shrink-0 items-center justify-center gap-1.5 border-l border-dashed border-border/60 px-3 outline-none transition-colors",
            "bg-muted/40 text-muted-foreground hover:bg-accent hover:text-foreground",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
            open && "bg-accent text-foreground",
          )}
          style={{ minWidth: TAB_TAIL_MIN_PX }}
          onContextMenu={(e) => {
            e.preventDefault()
            setOpen(true)
          }}
        >
          <LayoutList className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          <span className="text-[11px] font-medium">标签管理</span>
          <span className="rounded bg-background/80 px-1 py-px text-[10px] tabular-nums text-muted-foreground">
            {tabs.length}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem
          disabled={!activeId || tabs.length <= 1}
          onSelect={() => {
            if (activeId) closeOtherTabs(activeId)
          }}
        >
          关闭其他标签
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={() => closeAllTabs()}
        >
          关闭所有标签
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function TabCloseButton({
  title,
  active,
  onClose,
  className,
}: {
  title: string
  active?: boolean
  onClose: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      title="关闭"
      aria-label={`关闭 ${title}`}
      onClick={(e) => {
        e.stopPropagation()
        onClose()
      }}
      className={cn(
        "tab-close-narrow-overlay ml-auto -mr-0.5 flex h-7 w-7 min-h-7 min-w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-[opacity,background-color,color]",
        "hover:bg-accent hover:text-foreground active:bg-accent/80",
        "opacity-0 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring",
        "group-hover/tab:opacity-100 pointer-coarse:opacity-100",
        active && "opacity-100",
        className,
      )}
    >
      <X className="h-3.5 w-3.5" strokeWidth={2.25} />
    </button>
  )
}

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
        "@container/tab group/tab relative flex h-full shrink-0 cursor-pointer select-none items-center gap-1.5 px-2 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
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
      <TabCloseButton title={t.title} active={active} onClose={() => closeTab(t.id)} />
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
      <div className="flex min-w-0 flex-1 items-stretch">
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
        {tabs.length > 0 && <TabBarTailMenu tabs={tabs} activeId={activeId} />}
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
                <TabCloseButton
                  title={t.title}
                  onClose={() => closeTab(t.id)}
                  className="opacity-100"
                />
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
