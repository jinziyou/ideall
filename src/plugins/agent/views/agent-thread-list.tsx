"use client"

// AI 对话线程列表侧栏 (AgentPanel 非 compact 形态的左栏): 新建 / 选择 / 删除。
// 纯展示组件 —— 线程状态与增删编排归 AgentPanel。
import { Plus, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { AgentThread } from "../lib/model"

export default function AgentThreadList({
  threads,
  activeId,
  newLabel,
  emptyLabel,
  onNew,
  onSelect,
  onRemove,
}: {
  threads: AgentThread[]
  activeId: string | null
  newLabel: string
  emptyLabel: string
  onNew: () => void
  onSelect: (id: string) => void
  onRemove: (id: string) => void
}) {
  return (
    <aside className="flex w-48 shrink-0 flex-col md:w-52">
      <button
        type="button"
        onClick={onNew}
        className="mb-3 inline-flex h-9 items-center gap-2 rounded-md border bg-card px-3 text-sm font-medium transition-colors hover:bg-accent"
      >
        <Plus className="h-4 w-4" />
        {newLabel}
      </button>
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        {threads.length === 0 && (
          <p className="px-2 py-6 text-center text-[13px] text-muted-foreground">{emptyLabel}</p>
        )}
        {threads.map((t) => {
          const active = t.id === activeId
          return (
            <div
              key={t.id}
              className={cn(
                "group flex items-center gap-0.5 rounded-lg px-2 transition-colors",
                active ? "bg-accent/70" : "hover:bg-accent/40",
              )}
            >
              <button
                type="button"
                className="min-w-0 flex-1 truncate py-2 text-left text-sm"
                title={t.title}
                onClick={() => onSelect(t.id)}
              >
                {t.title}
              </button>
              <button
                type="button"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-background/80 hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
                title="删除"
                onClick={() => onRemove(t.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span className="sr-only">删除</span>
              </button>
            </div>
          )
        })}
      </div>
    </aside>
  )
}
