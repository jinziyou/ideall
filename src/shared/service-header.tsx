import type { ComponentType } from "react"
import { Badge } from "@/ui/badge"
import { cn } from "@/lib/utils"

/**
 * plugins 域统一签名 —— 方形图标位 + 「系统服务」徽章 + 状态字 (单行, 不再加冗余提示)。
 * core 与 plugin 皆可合法引用; 状态字不用 font-mono (中文为主, 避免 CJK 字体跳变)。
 */
export function ServiceHeader({
  icon: Icon,
  title,
  status,
  className,
}: {
  icon: ComponentType<{ className?: string }>
  title: string
  status?: { label: string; tone: "ok" | "warn" | "off" }
  className?: string
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border bg-muted">
        <Icon className="h-4 w-4" />
      </span>
      <span className="truncate text-sm font-medium">{title}</span>
      <Badge
        variant="outline"
        className="shrink-0 px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
      >
        系统服务
      </Badge>
      {status && (
        <span
          className={cn(
            "ml-auto inline-flex shrink-0 items-center gap-1.5 text-xs",
            status.tone === "ok" ? "text-foreground" : "text-muted-foreground",
          )}
        >
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              status.tone === "ok"
                ? "bg-pop"
                : status.tone === "warn"
                  ? "bg-destructive/70"
                  : "bg-muted-foreground/40",
            )}
          />
          {status.label}
        </span>
      )}
    </div>
  )
}
