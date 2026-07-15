"use client"

import { Lock } from "lucide-react"
import { formatBytes } from "@/lib/format"
import { cn } from "@/lib/utils"
import { PopoverClose } from "@/ui/popover"

export type LocalDeviceStatusValue = Readonly<{
  synced: boolean
  storage: Readonly<{ usage: number; quota: number }> | null
  publishingIdentity:
    | Readonly<{ signedIn: true; user: Readonly<{ email: string; name: string }> }>
    | Readonly<{ signedIn: false; user: null }>
}>

export function LocalDeviceStatusView({
  value,
  inPopover = false,
  onManageSync,
}: {
  value: LocalDeviceStatusValue
  inPopover?: boolean
  onManageSync(): void
}) {
  const manageButton = (
    <button
      type="button"
      onClick={onManageSync}
      className="mt-2.5 inline-block text-xs font-medium text-foreground hover:underline"
    >
      管理跨端同步 →
    </button>
  )

  return (
    <div>
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Lock className="h-4 w-4" />
        本机
      </div>
      <div className="mt-3 flex items-center justify-between rounded-md border bg-muted/40 px-2.5 py-2">
        <span className="text-xs">跨端同步</span>
        <span
          className={cn(
            "text-xs font-medium",
            value.synced ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {value.synced ? "已开启 · 端到端加密" : "未开启"}
        </span>
      </div>
      {value.storage && value.storage.quota > 0 ? (
        <div className="mt-2 rounded-md border bg-muted/40 px-2.5 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="shrink-0 text-xs">本地存储</span>
            <span className="font-mono text-xs tabular-nums">
              已用 {formatBytes(value.storage.usage)} / 共 {formatBytes(value.storage.quota)}
            </span>
          </div>
          <div className="mt-1.5 h-1 rounded-full bg-muted">
            <div
              className="h-1 rounded-full bg-pop"
              style={{
                width: `${Math.min(100, (value.storage.usage / value.storage.quota) * 100)}%`,
              }}
            />
          </div>
        </div>
      ) : null}
      <div className="mt-2 flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-2.5 py-2">
        <span className="shrink-0 text-xs">发布身份</span>
        <span
          className={cn(
            "min-w-0 truncate text-xs font-medium",
            value.publishingIdentity.signedIn ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {value.publishingIdentity.signedIn
            ? `已登录 · ${value.publishingIdentity.user.name || value.publishingIdentity.user.email}`
            : "未登录"}
        </span>
      </div>
      {inPopover ? <PopoverClose asChild>{manageButton}</PopoverClose> : manageButton}
    </div>
  )
}
