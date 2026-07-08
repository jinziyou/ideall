// 统一的「空状态」: 居中的 (可选)图标 + 标题 + (可选)操作区。全站列表为空 / 搜索无匹配 / AI 区段空白复用。
// - variant: "plain" 淡图标 (h-10 opacity-40, home 列表默认) | "halo" 圆底图标晕 (AI 区段)。
// - bordered: 默认渲染虚线边框容器; false 用于已有外框 (如卡片内 / AI 区) 的内联场景。
// - compact: 窄侧栏紧凑间距 (撑满 + 更小字号)。

import type { ComponentType, ReactNode } from "react"
import { cn } from "@/lib/utils"

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  bordered = true,
  variant = "plain",
  compact = false,
  className,
}: {
  icon?: ComponentType<{ className?: string }>
  /** 主标题 (必填) */
  title: string
  /** 辅助说明 (可选) */
  description?: string
  /** 操作区: 按钮等 (可选) */
  action?: ReactNode
  /** 是否渲染虚线边框容器 (默认 true; AI 区段常 false) */
  bordered?: boolean
  /** 图标样式: plain 淡图标 / halo 圆底晕 */
  variant?: "plain" | "halo"
  /** 窄侧栏紧凑间距 */
  compact?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center text-muted-foreground",
        compact ? "min-h-0 flex-1 gap-4 px-2 py-8" : "gap-3 px-4 py-16",
        bordered && !compact && "rounded-lg border border-dashed",
        className,
      )}
    >
      {Icon ? (
        variant === "halo" ? (
          <span className="grid size-16 place-items-center rounded-full bg-muted/50">
            <Icon className="size-7 text-muted-foreground" />
          </span>
        ) : (
          <Icon className="h-10 w-10 opacity-40" />
        )
      ) : null}
      <div>
        <p className={cn(compact ? "text-[13px] font-medium" : "text-sm")}>{title}</p>
        {description ? (
          <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {action ? (
        <div className="flex flex-wrap items-center justify-center gap-2">{action}</div>
      ) : null}
    </div>
  )
}
