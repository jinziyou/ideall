"use client"

// 小药丸 chip (范围/模式/状态文字)。自 plugins/agent 的 ui-kit 下沉为公共原语;
// 状态色配方 border-{tone}/30 + bg-{tone}/10 + text-{tone}, 与 StatusDot 共用 Tone 语义。
import * as React from "react"
import { cn } from "@/lib/utils"
import type { Tone } from "@/ui/status-dot"

const CHIP_TONE: Record<Tone | "neutral", string> = {
  neutral: "border-border text-muted-foreground",
  ok: "border-success/30 bg-success/10 text-success",
  warn: "border-warning/30 bg-warning/10 text-warning",
  error: "border-destructive/30 bg-destructive/10 text-destructive",
  idle: "border-border text-muted-foreground",
  info: "border-info/30 bg-info/10 text-info",
}

export function Chip({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode
  tone?: Tone | "neutral"
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        CHIP_TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
