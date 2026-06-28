// 统一的「空状态」: 居中的 (可选)图标 + 标题 + (可选)副说明 + (可选)操作区。
// 各 manager 列表为空 / 搜索无匹配时复用, 取代此前各处零散内联的 dashed-border 提示。
// 默认带虚线边框容器; bordered={false} 用于已有外框 (如卡片内) 的内联场景。

import type { ComponentType, ReactNode } from "react"
import { cn } from "@/lib/utils"

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  bordered = true,
  className,
}: {
  icon?: ComponentType<{ className?: string }>
  /** 主标题 (必填) */
  title: string
  /** 副说明 (可选) */
  description?: string
  /** 操作区: 按钮等 (可选) */
  action?: ReactNode
  /** 是否渲染虚线边框容器 (默认 true) */
  bordered?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-4 py-16 text-center text-muted-foreground",
        bordered && "rounded-lg border border-dashed",
        className,
      )}
    >
      {Icon ? <Icon className="h-10 w-10 opacity-40" /> : null}
      <div className="space-y-1">
        <p className="text-sm">{title}</p>
        {description ? <p className="text-xs text-muted-foreground/80">{description}</p> : null}
      </div>
      {action ? <div className="flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
    </div>
  )
}
