"use client"

// agent 视图的视觉套件 —— MCP / Skills / 规则 / 工作空间 / 全局设置 复用同一套基础组件。
// 通用原语已下沉 src/ui; 本文件只保留 agent 专属的组合件
// (AiPage/ListRow/AddButton/ComposerShell)。
// 视觉约定 (间距三档 / border-first / type ramp / 半径阶梯) 的成文规范: docs/design/ui-style.md。

import * as React from "react"
import { Plus, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

/** 标签页内容壳: 顶条 (标题 + 主操作) + 居中限宽滚动内容列。 */
export function AiPage({
  title,
  icon: Icon,
  action,
  width = "3xl",
  children,
}: {
  title: string
  icon?: LucideIcon
  action?: React.ReactNode
  width?: "2xl" | "3xl"
  children: React.ReactNode
}) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-6">
        {Icon && <Icon className="h-[1.1rem] w-[1.1rem] shrink-0 text-muted-foreground" />}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-semibold leading-tight">{title}</h1>
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div
          className={cn("mx-auto w-full px-6 py-6", width === "2xl" ? "max-w-2xl" : "max-w-3xl")}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

/** 列表行 (MCP / Skills / 规则 共用): 前导(点/图标) + 标题/副标题 + 尾部(徽标/开关)。 */
export function ListRow({
  leading,
  title,
  subtitle,
  trailing,
  active,
  onClick,
}: {
  leading?: React.ReactNode
  title: React.ReactNode
  subtitle?: React.ReactNode
  trailing?: React.ReactNode
  active?: boolean
  onClick?: () => void
}) {
  const cls = cn(
    "flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors",
    active
      ? "border-primary/40 bg-primary/5"
      : "bg-card hover:border-foreground/20 hover:bg-accent/50",
  )
  const main = (
    <>
      {leading && <span className="flex shrink-0 items-center">{leading}</span>}
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm font-medium">{title}</span>
        {subtitle && (
          <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">
            {subtitle}
          </span>
        )}
      </span>
    </>
  )
  if (!onClick) {
    return (
      <div className={cls}>
        {main}
        {trailing && <span className="flex shrink-0 items-center gap-2">{trailing}</span>}
      </div>
    )
  }
  return (
    <div className={cls}>
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {main}
      </button>
      {trailing && <span className="flex shrink-0 items-center gap-2">{trailing}</span>}
    </div>
  )
}

/** 区段「+ 添加」按钮 (放在 AiPage.action 或 Panel.action)。 */
export function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-card px-3 text-sm font-medium transition-colors hover:bg-accent"
    >
      <Plus className="h-4 w-4" />
      {label}
    </button>
  )
}

/** 对话输入壳: 圆角面板 + 内边距, 贴底 composer 复用。 */
export function ComposerShell({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("rounded-lg border bg-card p-3 shadow-none", className)}>{children}</div>
  )
}
