"use client"

// 「我的」二级侧栏: 4 个常驻区段 (关注 / 收藏 / 发布 / 笔记)。
// 点区段 = 在主区开/激活对应标签 (module:"home", 活动栏「我的」保持高亮)。
// 概览不在此列 —— 由活动栏「我的」钮直达 (见 store.openHome)。

import { cn } from "@/lib/utils"
import { HOME_SECTIONS } from "./home-sections"
import { openTab, tabKey, useActiveId } from "./store"

export default function HomeSidebar() {
  const activeId = useActiveId()

  return (
    <div className="flex-1 overflow-y-auto p-2">
      <nav className="flex flex-col gap-0.5">
        {HOME_SECTIONS.map((s) => {
          const Icon = s.icon
          const active = activeId === tabKey(s.descriptor)
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => openTab(s.descriptor)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-shell px-2.5 py-2 text-sm transition-colors",
                active
                  ? "bg-primary/10 font-medium text-primary"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="flex-1 truncate text-left">{s.label}</span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}
