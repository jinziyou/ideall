"use client"

import type * as React from "react"
import { Archive, ClipboardCopy, Download, RefreshCw } from "lucide-react"
import { Button } from "@/ui/button"

export function SectionTitle({
  icon: Icon,
  title,
  actions,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  actions?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="h-4 w-4 shrink-0 text-primary" />
        <h2 className="truncate text-sm font-medium">{title}</h2>
      </div>
      {actions}
    </div>
  )
}

export function CodePageHeader({
  onRefresh,
  onCopy,
  onDownload,
  onArchive,
}: {
  onRefresh?: () => void
  onCopy?: () => void
  onDownload?: () => void
  onArchive?: () => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Code</h1>
          <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
            本地运行态、工作区快照与浏览器存储诊断
          </p>
        </div>
        {onRefresh && onCopy && onDownload && onArchive && (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={onArchive}
            >
              <Archive className="h-4 w-4" />
              归档
            </Button>
            <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={onCopy}>
              <ClipboardCopy className="h-4 w-4" />
              复制
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={onDownload}
            >
              <Download className="h-4 w-4" />
              导出
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={onRefresh}
            >
              <RefreshCw className="h-4 w-4" />
              刷新
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
