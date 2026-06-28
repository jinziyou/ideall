"use client"

// 顶部标签条 (多标签): 模块色点 + 标题 + 关闭; 支持横向溢出滚动与拖拽重排。
// 右端「更多 ⌄」溢出下拉列全部标签 (溢出滚出视野后仍可发现/跳转 —— 一切皆标签页下多标签是常态)。
// 全键盘可达: 标签 role=tab 可聚焦, Enter/Space 激活, Delete 关闭, Ctrl+Shift+←/→ 重排 (拖拽的键盘替代)。
// URL 同步由 WorkspaceShell 的 effect 统一负责 (这里只改 store)。

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
import { tabViewType, TAB_VIEW_LABEL } from "./tab-view-type"
import { MODULE_DOT } from "./module-dot"

export default function TabBar() {
  const tabs = useTabs()
  const activeId = useActiveId()
  const dragId = React.useRef<string | null>(null)

  return (
    <div className="hidden h-10 shrink-0 items-center gap-1 border-b bg-secondary/30 px-2 md:flex">
      <div role="tablist" className="flex flex-1 items-center gap-1 overflow-x-auto">
        {tabs.length === 0 ? (
          <span className="px-1 text-xs text-muted-foreground">从左侧选择一个面板打开</span>
        ) : (
          tabs.map((t, i) => {
            const active = t.id === activeId
            return (
              <div
                key={t.id}
                role="tab"
                tabIndex={active ? 0 : -1}
                aria-selected={active}
                draggable
                onDragStart={() => {
                  dragId.current = t.id
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragId.current) reorderTabs(dragId.current, t.id)
                  dragId.current = null
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
                    // Ctrl+Shift+←/→ = 重排 (拖拽的键盘替代)
                    e.preventDefault()
                    reorderTabs(t.id, tabs[i - 1].id)
                  } else if (e.ctrlKey && e.shiftKey && e.key === "ArrowRight" && i < tabs.length - 1) {
                    e.preventDefault()
                    reorderTabs(t.id, tabs[i + 1].id)
                  } else if (e.key === "ArrowLeft") {
                    // ←/→ = 在标签间移动焦点 (roving tabindex, WAI-ARIA tablist 规范)
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
                  // 中键关闭
                  if (e.button === 1) {
                    e.preventDefault()
                    closeTab(t.id)
                  }
                }}
                className={cn(
                  "group/tab flex h-8 min-w-[7rem] max-w-[16rem] shrink-0 cursor-pointer select-none items-center gap-1.5 rounded-shell px-2.5 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
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
                  className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded opacity-0 outline-none transition-opacity hover:bg-accent focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover/tab:opacity-70",
                    active && "opacity-50",
                  )}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )
          })
        )}
      </div>

      {/* 溢出「更多」下拉: 列全部标签, 点击跳转 (溢出滚出视野后仍可发现/定位激活标签)。 */}
      {tabs.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title="全部标签"
              aria-label="全部标签"
              className="flex h-7 shrink-0 items-center gap-0.5 rounded-shell px-1.5 text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
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
