"use client"

// 顶部标签条 (多标签): 模块色点 + 标题 + 关闭; 支持横向溢出滚动与拖拽重排。
// URL 同步由 WorkspaceShell 的 effect 统一负责 (这里只改 store)。

import * as React from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTabs, useActiveId, setActiveTab, closeTab, reorderTabs } from "./store"
import type { ModuleId } from "./types"

const DOT: Record<ModuleId, string> = {
  home: "bg-primary",
  subscriptions: "bg-spoke-info",
  info: "bg-spoke-info",
  community: "bg-spoke-community",
  browser: "bg-spoke-tool",
  tool: "bg-spoke-tool",
  agent: "bg-primary",
}

export default function TabBar() {
  const tabs = useTabs()
  const activeId = useActiveId()
  const dragId = React.useRef<string | null>(null)

  return (
    <div className="hidden h-10 shrink-0 items-center gap-1 border-b bg-secondary/30 px-2 md:flex">
      <div className="flex flex-1 items-center gap-1 overflow-x-auto">
        {tabs.length === 0 ? (
          <span className="px-1 text-xs text-muted-foreground">从左侧选择一个面板打开</span>
        ) : (
          tabs.map((t) => {
            const active = t.id === activeId
            return (
              <div
                key={t.id}
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
                onAuxClick={(e) => {
                  // 中键关闭
                  if (e.button === 1) {
                    e.preventDefault()
                    closeTab(t.id)
                  }
                }}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group/tab flex h-8 min-w-[7rem] max-w-[14rem] shrink-0 cursor-pointer select-none items-center gap-2 rounded-shell px-2.5 text-[13px] transition-colors",
                  active
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT[t.module])} />
                <span className="flex-1 truncate">{t.title}</span>
                <button
                  type="button"
                  tabIndex={-1}
                  title="关闭"
                  aria-label={`关闭 ${t.title}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    closeTab(t.id)
                  }}
                  className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded opacity-0 transition-opacity hover:bg-accent group-hover/tab:opacity-70",
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
    </div>
  )
}
