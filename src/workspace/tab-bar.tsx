"use client"

// 顶部标签条: 固定宽度标签 + 横向滚动; 右侧一体展示「管理 14 ▾」, 左/右分置触发。
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
import {
  useTabs,
  useActiveId,
  useTransientId,
  useDirtyTabIds,
  setActiveTab,
  promoteTab,
  requestCloseTab,
  requestCloseAllTabs,
  requestCloseOtherTabs,
  reorderTabs,
} from "./store"
import type { Tab } from "./types"
import { tabViewType, TAB_VIEW_LABEL, tabElId, tabPanelId } from "./tab-view-type"
import { MODULE_DOT } from "./module-dot"
import { parseNodeParams } from "./node-tab"
import { FileTypeIcon } from "@/shared/file-type-icon"

/** Chrome 近似: 最小保留色点 + 截断标题, 最大 ~240px; 溢出时横向滚动。 */
const TAB_MIN_PX = 96
const TAB_MAX_PX = 240

const tabTailTrigger =
  "flex h-full shrink-0 items-center outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"

function isFileTab(t: Tab): boolean {
  if (t.kind !== "node") return false
  return parseNodeParams(t.params)?.kind === "file"
}

function TabLeadingMark({
  tab,
  active,
  compact = false,
  transient = false,
}: {
  tab: Tab
  active?: boolean
  compact?: boolean
  /** 预览标签: 色点略小、略淡, 无激活光环 —— 与已固定标签区分。 */
  transient?: boolean
}) {
  if (isFileTab(tab)) {
    return (
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded bg-muted/70",
          compact ? "h-4 w-4" : "h-5 w-5",
          active && !transient && "bg-background",
          active && transient && "bg-background/70",
          transient && "opacity-55",
        )}
      >
        <FileTypeIcon name={tab.title} className={compact ? "h-3.5 w-3.5" : "h-3.5 w-3.5"} />
      </span>
    )
  }

  return (
    <span
      className={cn(
        "shrink-0 rounded-full transition-[width,height,opacity,box-shadow]",
        compact
          ? "h-1.5 w-1.5"
          : transient
            ? active
              ? "h-2 w-2"
              : "h-1.5 w-1.5"
            : active
              ? "h-2.5 w-2.5 shadow-[0_0_0_2px_hsl(var(--background)),0_0_0_3px_hsl(var(--primary)/0.55)]"
              : "h-2 w-2",
        MODULE_DOT[tab.module],
        transient && (active ? "opacity-55" : "opacity-35"),
      )}
    />
  )
}

function TabBarTail({
  tabs,
  activeId,
  dirtyIds,
}: {
  tabs: Tab[]
  activeId: string | null
  dirtyIds: Set<string>
}) {
  const [mgmtOpen, setMgmtOpen] = React.useState(false)
  const [listOpen, setListOpen] = React.useState(false)

  return (
    <div
      className={cn(
        "flex h-full shrink-0 items-stretch gap-0.5 border-l border-dashed border-border/60 bg-muted/40 pl-1.5 pr-1 text-muted-foreground",
        (mgmtOpen || listOpen) && "text-foreground",
      )}
    >
      <DropdownMenu open={mgmtOpen} onOpenChange={setMgmtOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title="管理标签"
            aria-label="管理标签"
            className={cn(
              tabTailTrigger,
              "gap-1 rounded-shell pl-1.5 pr-0.5",
              mgmtOpen && "bg-accent text-foreground",
            )}
            onContextMenu={(e) => {
              e.preventDefault()
              setMgmtOpen(true)
            }}
          >
            <LayoutList className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
            <span className="text-[11px] font-medium">管理</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem
            disabled={!activeId || tabs.length <= 1}
            onSelect={() => {
              if (activeId) requestCloseOtherTabs(activeId)
            }}
          >
            关闭其他标签
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => requestCloseAllTabs()}
          >
            关闭所有标签
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <span className="flex items-center rounded-shell bg-background/80 px-1 py-px text-[10px] tabular-nums text-muted-foreground">
        {tabs.length}
      </span>

      <DropdownMenu open={listOpen} onOpenChange={setListOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title="全部标签"
            aria-label={`全部标签，共 ${tabs.length} 个`}
            className={cn(
              tabTailTrigger,
              "rounded-shell px-1 pr-1.5",
              listOpen && "bg-accent text-foreground",
            )}
          >
            <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" strokeWidth={2} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-[60vh] w-64 overflow-y-auto">
          {tabs.map((t) => (
            <DropdownMenuItem
              key={t.id}
              onSelect={() => setActiveTab(t.id)}
              className={cn("gap-2", t.id === activeId && "bg-accent/60 font-medium")}
            >
              <TabLeadingMark tab={t} active={t.id === activeId} compact />
              <span className="shrink-0 rounded bg-muted px-1 py-px text-[10px] font-medium text-muted-foreground">
                {TAB_VIEW_LABEL[tabViewType(t)]}
              </span>
              <span className="min-w-0 flex-1 truncate" title={t.title}>
                {t.title}
              </span>
              {dirtyIds.has(t.id) && (
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
              )}
              <TabCloseButton
                title={t.title}
                dirty={dirtyIds.has(t.id)}
                onClose={() => requestCloseTab(t.id)}
                className="opacity-100"
              />
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function TabCloseButton({
  title,
  active,
  dirty,
  onClose,
  className,
}: {
  title: string
  active?: boolean
  dirty?: boolean
  onClose: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      title={dirty ? "关闭（有未保存更改）" : "关闭"}
      aria-label={`关闭 ${title}${dirty ? "，有未保存更改" : ""}`}
      onClick={(e) => {
        e.stopPropagation()
        onClose()
      }}
      // 关闭走标签本体的 Delete/Backspace (见 TabItem onKeyDown), 故关闭钮不进 Tab 序 —— 否则
      // roving tabindex 的 tablist 会被它打破 (Tab 不到非激活标签本体却能停到其关闭钮)。
      tabIndex={-1}
      className={cn(
        "relative ml-auto -mr-0.5 flex h-7 w-7 min-h-7 min-w-7 shrink-0 items-center justify-center rounded-shell text-muted-foreground outline-none transition-[opacity,background-color,color]",
        "hover:bg-accent hover:text-foreground active:bg-accent/80",
        "opacity-0 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring",
        "group-hover/tab:opacity-100 pointer-coarse:opacity-100",
        // 触屏 (pointer-coarse): 视觉仍 28px, 命中区经伪元素扩到 ~44px (WCAG 2.5.8 舒适触达)。
        "pointer-coarse:before:absolute pointer-coarse:before:-inset-2 pointer-coarse:before:content-['']",
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
  transient,
  dirty,
  dragIdRef,
  tabRef,
}: {
  tab: Tab
  index: number
  tabs: Tab[]
  active: boolean
  transient: boolean
  dirty: boolean
  dragIdRef: React.MutableRefObject<string | null>
  tabRef: (el: HTMLDivElement | null) => void
}) {
  return (
    <div
      ref={tabRef}
      role="tab"
      id={tabElId(t.id)}
      aria-controls={tabPanelId(t.id)}
      tabIndex={active ? 0 : -1}
      aria-selected={active}
      title={dirty ? `${t.title} · 未保存` : transient ? `${t.title} · 预览 (双击固定)` : t.title}
      draggable
      onDragStart={() => {
        dragIdRef.current = t.id
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={() => {
        if (dragIdRef.current) reorderTabs(dragIdRef.current, t.id)
        dragIdRef.current = null
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => setActiveTab(t.id)}
      onDoubleClick={() => promoteTab(t.id)}
      onKeyDown={(e) => {
        const el = e.currentTarget
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          setActiveTab(t.id)
        } else if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault()
          requestCloseTab(t.id)
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
          requestCloseTab(t.id)
        }
      }}
      style={{ minWidth: TAB_MIN_PX, maxWidth: TAB_MAX_PX }}
      className={cn(
        "@container/tab group/tab relative flex h-full shrink-0 cursor-pointer select-none items-center gap-1.5 px-2 text-[13px] outline-none transition-[color,background-color,box-shadow,border-color] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        active
          ? cn(
              "z-[1] -mb-px border-b-2 text-foreground shadow-[inset_0_1px_0_0_hsl(var(--border)/0.35)]",
              // 预览标签: 轻底 + 淡强调色 (不用 italic / 虚线底 —— 中文 UI 上观感差)。
              transient
                ? "border-primary/35 bg-muted/25 font-normal hover:border-primary/50"
                : "border-primary bg-background font-medium",
            )
          : cn(
              "border-r border-border/40 text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              transient && "text-muted-foreground/75",
            ),
      )}
    >
      <TabLeadingMark tab={t} active={active} transient={transient} />
      <span className="hidden shrink-0 rounded bg-muted px-1 py-px text-[10px] font-medium text-muted-foreground @[96px]/tab:inline">
        {TAB_VIEW_LABEL[tabViewType(t)]}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          transient &&
            active &&
            "underline decoration-primary/25 decoration-dotted underline-offset-[5px] decoration-[1px]",
        )}
        title={t.title}
      >
        {t.title}
      </span>
      {dirty && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />}
      <TabCloseButton
        title={t.title}
        active={active || dirty}
        dirty={dirty}
        onClose={() => requestCloseTab(t.id)}
      />
    </div>
  )
}

export default function TabBar() {
  const tabs = useTabs()
  const activeId = useActiveId()
  const transientId = useTransientId()
  const dirtyIds = new Set(useDirtyTabIds())
  const dragIdRef = React.useRef<string | null>(null)
  const tabRefs = React.useRef(new Map<string, HTMLDivElement>())

  React.useEffect(() => {
    if (!activeId) return
    const el = tabRefs.current.get(activeId)
    el?.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" })
  }, [activeId, tabs.length])

  return (
    <div className="hidden h-9 shrink-0 items-stretch border-b bg-secondary/30 md:flex">
      <div className="flex min-w-0 flex-1 items-stretch">
        <div
          role="tablist"
          className="flex min-w-0 flex-1 items-stretch overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {tabs.length === 0 ? (
            <span className="flex items-center px-3 text-xs text-muted-foreground">
              从左侧活动栏选择一个模块开始（单击预览 · 双击固定）
            </span>
          ) : (
            tabs.map((t, i) => (
              <TabItem
                key={t.id}
                tab={t}
                index={i}
                tabs={tabs}
                active={t.id === activeId}
                transient={t.id === transientId}
                dirty={dirtyIds.has(t.id)}
                dragIdRef={dragIdRef}
                tabRef={(el) => {
                  if (el) tabRefs.current.set(t.id, el)
                  else tabRefs.current.delete(t.id)
                }}
              />
            ))
          )}
        </div>
        {tabs.length > 0 && <TabBarTail tabs={tabs} activeId={activeId} dirtyIds={dirtyIds} />}
      </div>
    </div>
  )
}
