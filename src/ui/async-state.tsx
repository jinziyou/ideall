import type { ReactNode } from "react"
import { AlertTriangle, Loader2 } from "lucide-react"
import { Button } from "./button"
import { EmptyState } from "./empty-state"
import { cn } from "@/lib/utils"

export type AsyncStateStatus = "loading" | "empty" | "error" | "ready"

export function AsyncState({
  status,
  children,
  loadingLabel = "加载中…",
  emptyTitle = "暂无内容",
  emptyDescription,
  errorTitle = "加载失败",
  errorDescription = "请稍后重试。",
  retryLabel = "重试",
  onRetry,
  compact = false,
  className,
}: {
  status: AsyncStateStatus
  children?: ReactNode
  loadingLabel?: string
  emptyTitle?: string
  emptyDescription?: string
  errorTitle?: string
  errorDescription?: string
  retryLabel?: string
  onRetry?: () => void
  compact?: boolean
  className?: string
}) {
  if (status === "ready") return <>{children}</>
  if (status === "loading") {
    return (
      <div
        role="status"
        aria-live="polite"
        className={cn(
          "flex items-center justify-center gap-2 text-sm text-muted-foreground",
          compact ? "py-6" : "min-h-32 py-12",
          className,
        )}
      >
        <Loader2 className="size-5 animate-spin" aria-hidden />
        <span>{loadingLabel}</span>
      </div>
    )
  }
  return (
    <EmptyState
      icon={status === "error" ? AlertTriangle : undefined}
      title={status === "error" ? errorTitle : emptyTitle}
      description={status === "error" ? errorDescription : emptyDescription}
      action={
        status === "error" && onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            {retryLabel}
          </Button>
        ) : undefined
      }
      compact={compact}
      className={className}
    />
  )
}
