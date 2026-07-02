"use client"

// 面板族公共原语 (「现代 · 面板 · 留白」的载体), 自 plugins/agent 的 ui-kit 下沉:
// Panel = 区段卡片; SettingRow = 设置行 (label 左 / 控件右); SurfacePanel = 内容区浮动面板。
// 口径: rounded-lg border bg-card, 零阴影 (border-first); 间距三档见 docs/design/ui-style.md。
import * as React from "react"
import { cn } from "@/lib/utils"

/** 区段卡片 (rounded-lg border bg-card; 标题/操作 + 内容)。 */
export function Panel({
  title,
  action,
  children,
  className,
}: {
  title?: string
  action?: React.ReactNode
  children?: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn("rounded-lg border bg-card", className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-4 px-5 pt-5">
          <div className="min-w-0">
            {title && <h2 className="text-base font-semibold leading-tight">{title}</h2>}
          </div>
          {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  )
}

/** 设置行: 左标签/描述, 右控件 (label-left / control-right)。配合 Panel + divide-y。 */
export function SettingRow({
  label,
  children,
  htmlFor,
}: {
  label: string
  children: React.ReactNode
  htmlFor?: string
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="block text-sm font-medium">
          {label}
        </label>
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
}

/** 内容区浮动面板 (主工作区 / 侧栏内卡片)。 */
export function SurfacePanel({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card",
        className,
      )}
    >
      {children}
    </div>
  )
}
