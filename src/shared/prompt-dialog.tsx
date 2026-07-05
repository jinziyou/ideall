"use client"

import * as React from "react"
import { Button } from "@/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog"
import { Input } from "@/ui/input"
import { Label } from "@/ui/label"

/**
 * ConfirmDialog —— 替代 window.confirm 的确认对话框。
 * destructive 只用现有 destructive token, 不引新色。
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "确定",
  destructive = false,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  confirmLabel?: string
  destructive?: boolean
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description ?? "确认此操作。"}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={() => {
              onConfirm()
              onOpenChange(false)
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * TextPromptDialog —— 替代 window.prompt 的单行文本输入对话框。
 * Enter 即提交; 提交前 .trim(), 空值不提交。
 */
export function TextPromptDialog({
  open,
  onOpenChange,
  title,
  label = "名称",
  defaultValue = "",
  placeholder,
  confirmLabel = "确定",
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  label?: string
  defaultValue?: string
  placeholder?: string
  confirmLabel?: string
  onSubmit: (value: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>输入{label}后确认提交。</DialogDescription>
        </DialogHeader>
        {/* 输入状态放在内部组件: Dialog 关闭即卸载, 每次打开重置为 defaultValue (上次输入不残留) */}
        <PromptForm
          label={label}
          defaultValue={defaultValue}
          placeholder={placeholder}
          confirmLabel={confirmLabel}
          onCancel={() => onOpenChange(false)}
          onSubmit={(v) => {
            onSubmit(v)
            onOpenChange(false)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

function PromptForm({
  label,
  defaultValue,
  placeholder,
  confirmLabel,
  onCancel,
  onSubmit,
}: {
  label: string
  defaultValue: string
  placeholder?: string
  confirmLabel: string
  onCancel: () => void
  onSubmit: (value: string) => void
}) {
  const [value, setValue] = React.useState(defaultValue)
  const inputId = React.useId()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const v = value.trim()
    if (!v) return
    onSubmit(v)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor={inputId}>{label}</Label>
        <Input
          id={inputId}
          autoFocus
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
        />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit">{confirmLabel}</Button>
      </DialogFooter>
    </form>
  )
}
