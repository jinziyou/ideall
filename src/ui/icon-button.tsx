"use client"

// 壳层图标按钮: 统一命中尺寸 / 圆角 (rounded-shell) / focus 环 / hover 反馈。
// 活动栏 · 标签条 · 侧栏 · AI 栏 · 浏览器工具条等处的图标钮共用, 取代各处零散内联实现。
// 颜色/状态态 (如 aria-pressed 的 text-primary) 经 className 覆盖 (tailwind-merge)。
import * as React from "react"
import { cn } from "@/lib/utils"

const SIZE = {
  sm: "h-7 w-7", // 紧凑处 (窄侧栏)
  md: "h-8 w-8", // 默认 chrome 命中尺寸 (≥32px, 触控友好)
} as const

export type IconButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: keyof typeof SIZE
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { size = "md", className, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-shell text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        SIZE[size],
        className,
      )}
      {...props}
    />
  )
})
