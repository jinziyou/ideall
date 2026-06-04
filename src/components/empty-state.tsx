import * as React from "react"
import { cn } from "@/lib/utils"

/** 通用空态: 图标 + 标题 + 说明 + 可选行动区。用于把「空屏」变成有引导的一屏。 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  className,
  children,
}: {
  icon?: React.ComponentType<{ className?: string }>
  title: string
  description?: string
  className?: string
  children?: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed bg-card/50 px-6 py-12 text-center",
        className,
      )}
    >
      {Icon && <Icon className="mb-3 h-8 w-8 text-muted-foreground" />}
      <h3 className="text-base font-semibold">{title}</h3>
      {description && <p className="mt-1.5 max-w-md text-sm text-muted-foreground">{description}</p>}
      {children && <div className="mt-5">{children}</div>}
    </div>
  )
}
