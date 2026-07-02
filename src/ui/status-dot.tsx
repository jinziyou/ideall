"use client"

// 状态点 + 计数徽标 (全站唯一状态色映射来源)。自 plugins/agent 的 ui-kit 下沉为公共原语:
// 状态语义色的消费口径全站统一 —— ok→success / warn→warning / error→destructive /
// idle→muted / info→info (令牌定义见 globals.css「状态语义色」注释)。
// bg-pop 严格保留给「流回/加入我的」语义, 不得兼职表示运行状态。
import * as React from "react"
import { cn } from "@/lib/utils"

export type Tone = "ok" | "warn" | "error" | "idle" | "info"

const DOT_TONE: Record<Tone, string> = {
  ok: "bg-success",
  warn: "bg-warning",
  error: "bg-destructive",
  idle: "bg-muted-foreground/60",
  info: "bg-info",
}

/** 状态点 (size-2 + 同底色描边防融底)。 */
export function StatusDot({ tone = "idle", className }: { tone?: Tone; className?: string }) {
  return (
    <span
      className={cn(
        "inline-block size-2 shrink-0 rounded-full ring-2 ring-card",
        DOT_TONE[tone],
        className,
      )}
    />
  )
}

/** 计数徽标。 */
export function CountBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-grid h-5 min-w-5 place-items-center rounded-full bg-muted px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground">
      {children}
    </span>
  )
}
