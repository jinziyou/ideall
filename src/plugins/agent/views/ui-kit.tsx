"use client"

// AI 重设计共享视觉套件 (现代 · 面板 · 留白) —— MCP / Skills / 规则 / 工作空间 / 全局设置 复用同一套原语,
// 使异质概念读作同一系统。视觉契约 (源于 Geist/Linear/Stripe/shadcn 调研):
//   间距 3 档: gap-2(组内) / gap-4(行间) / space-y-8(区段间);
//   border-first 几无阴影 (卡片 rounded-lg border bg-card; shadow 仅留弹层);
//   内容列 max-w-2xl/3xl mx-auto (留白=现代感); 半径阶梯 controls=rounded-md / cards=rounded-lg (便当 --radius, 全站统一);
//   type ramp: 标题 text-base font-semibold / 正文 text-sm / meta text-[13px] text-muted-foreground;
//   状态点 size-2 ring-2 ring-card; 色彩走语义 token (success/warning/info/destructive), 近乎只留给状态点与主操作。

import * as React from "react"
import { Plus, type LucideIcon } from "lucide-react"
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

const CHIP_TONE: Record<Tone | "neutral", string> = {
  neutral: "border-border text-muted-foreground",
  ok: "border-success/30 bg-success/10 text-success",
  warn: "border-warning/30 bg-warning/10 text-warning",
  error: "border-destructive/30 bg-destructive/10 text-destructive",
  idle: "border-border text-muted-foreground",
  info: "border-info/30 bg-info/10 text-info",
}

/** 小药丸 chip (范围/模式/状态文字)。 */
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

/** 开关 (无 @/ui/switch → 本套件自带; 可访问 role=switch)。 */
export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  label?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-40",
        checked ? "bg-primary" : "bg-input",
      )}
    >
      <span
        className={cn(
          "inline-block size-4 rounded-full bg-background shadow-sm transition-transform",
          checked ? "translate-x-[1.125rem]" : "translate-x-0.5",
        )}
      />
    </button>
  )
}

/** 标签页内容壳: 顶条 (标题 + 主操作) + 居中限宽滚动内容列。 */
export function AiPage({
  title,
  icon: Icon,
  action,
  width = "3xl",
  children,
}: {
  title: string
  icon?: LucideIcon
  action?: React.ReactNode
  width?: "2xl" | "3xl"
  children: React.ReactNode
}) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-6">
        {Icon && <Icon className="h-[1.1rem] w-[1.1rem] shrink-0 text-muted-foreground" />}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-semibold leading-tight">{title}</h1>
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div
          className={cn("mx-auto w-full px-6 py-6", width === "2xl" ? "max-w-2xl" : "max-w-3xl")}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

/** 区段卡片 (rounded-xl border bg-card; 标题/描述 + 内容)。 */
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

/** 列表行 (MCP / Skills / 规则 共用): 前导(点/图标) + 标题/副标题 + 尾部(徽标/开关)。 */
export function ListRow({
  leading,
  title,
  subtitle,
  trailing,
  active,
  onClick,
}: {
  leading?: React.ReactNode
  title: React.ReactNode
  subtitle?: React.ReactNode
  trailing?: React.ReactNode
  active?: boolean
  onClick?: () => void
}) {
  const cls = cn(
    "flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors",
    active
      ? "border-primary/40 bg-primary/5"
      : "bg-card hover:border-foreground/20 hover:bg-accent/50",
  )
  const main = (
    <>
      {leading && <span className="flex shrink-0 items-center">{leading}</span>}
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm font-medium">{title}</span>
        {subtitle && (
          <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">
            {subtitle}
          </span>
        )}
      </span>
    </>
  )
  if (!onClick) {
    return (
      <div className={cls}>
        {main}
        {trailing && <span className="flex shrink-0 items-center gap-2">{trailing}</span>}
      </div>
    )
  }
  return (
    <div className={cls}>
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {main}
      </button>
      {trailing && (
        <span className="flex shrink-0 items-center gap-2">{trailing}</span>
      )}
    </div>
  )
}

/** 区段「+ 添加」按钮 (放在 AiPage.action 或 Panel.action)。 */
export function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-card px-3 text-sm font-medium transition-colors hover:bg-accent"
    >
      <Plus className="h-4 w-4" />
      {label}
    </button>
  )
}

/** 对话输入壳: 圆角面板 + 内边距, 贴底 composer 复用。 */
export function ComposerShell({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-lg border bg-card p-3 shadow-none", className)}>{children}</div>
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
    <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card", className)}>
      {children}
    </div>
  )
}
