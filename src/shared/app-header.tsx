import { cn } from "@/lib/utils"
import CommandTrigger from "./command-trigger"

/**
 * 三 app 统一页头 —— spoke 色点 + 标题 + 一句回流定位描述, 右侧方案 3 命令台触发器 (⌘K)。
 * dotClass 由各 app 以静态字面量传入 (bg-spoke-info / bg-spoke-community / bg-spoke-tool)。
 */
export function AppHeader({
  title,
  dotClass,
  description,
}: {
  title: string
  dotClass: string
  description?: string
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <span className={cn("h-2 w-2 rounded-full", dotClass)} />
          {title}
        </h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      <CommandTrigger className="h-9 w-full sm:w-64" />
    </header>
  )
}
