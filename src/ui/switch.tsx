"use client"

// 开关 (受控; role=switch 可访问)。自 plugins/agent 的 ui-kit 下沉为公共原语 ——
// 此前 src/ui 缺 Switch, 插件被迫自造, 其他模块要用开关时无处可拿。
// 钮面 shadow-sm 属控件微阴影, border-first 口径下允许 (见 docs/design/ui-style.md)。
import * as React from "react"
import { cn } from "@/lib/utils"

export function Switch({
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
