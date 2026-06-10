"use client"

import * as React from "react"
import { Lock } from "lucide-react"
import { cn } from "@/lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { getSyncCode, subscribeSyncCode } from "@/lib/sync-code"
import { formatBytes } from "@/lib/hub-format"
import { getSession, subscribeSession } from "@protocol/auth"

function getServerSnapshot(): string | null {
  return null
}

/**
 * 本地·此设备 所有权药丸 + 全站唯一的「系统状态」面板:
 * 跨端同步状态 / 本地存储用量 / 发布身份, 以及双身份说明。
 */
export default function LocalDeviceChip() {
  const code = React.useSyncExternalStore(subscribeSyncCode, getSyncCode, getServerSnapshot)
  const session = React.useSyncExternalStore(subscribeSession, getSession, () => null)
  const synced = Boolean(code)
  const [storage, setStorage] = React.useState<{ usage: number; quota: number } | null>(null)

  React.useEffect(() => {
    let cancelled = false
    async function estimate() {
      try {
        const est = await navigator.storage?.estimate?.()
        if (!cancelled && est) setStorage({ usage: est.usage ?? 0, quota: est.quota ?? 0 })
      } catch {
        /* 估算失败则不展示存储行 */
      }
    }
    void estimate()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Lock className="h-3.5 w-3.5" />
          {synced && <span className="h-1.5 w-1.5 rounded-full bg-pop" />}
          <span className="hidden lg:inline">本机</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Lock className="h-4 w-4" />
          本机
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          订阅、书签等数据只存本机，默认
          <b className="font-medium text-foreground">不上传服务器</b>。
        </p>
        <div className="mt-3 flex items-center justify-between rounded-md border bg-muted/40 px-2.5 py-2">
          <span className="text-xs">跨端同步</span>
          <span
            className={cn(
              "text-xs font-medium",
              synced ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {synced ? "已开启 · 端到端加密" : "未开启"}
          </span>
        </div>
        {storage && storage.quota > 0 && (
          <div className="mt-2 rounded-md border bg-muted/40 px-2.5 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="shrink-0 text-xs">本地存储</span>
              <span className="font-mono text-xs tabular-nums">
                已用 {formatBytes(storage.usage)}
              </span>
            </div>
            <div className="mt-1.5 h-1 rounded-full bg-muted">
              <div
                className="h-1 rounded-full bg-pop"
                style={{ width: `${Math.min(100, (storage.usage / storage.quota) * 100)}%` }}
              />
            </div>
          </div>
        )}
        <div className="mt-2 flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-2.5 py-2">
          <span className="shrink-0 text-xs">发布身份</span>
          <span
            className={cn(
              "min-w-0 truncate text-xs font-medium",
              session ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {session ? `已登录 · ${session.user.name || session.user.email}` : "未登录"}
          </span>
        </div>
        <a
          href="/home/subscriptions"
          className="mt-2.5 inline-block text-xs font-medium text-foreground hover:underline"
        >
          管理跨端同步 →
        </a>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          登录账号只用于社区发布，与本机数据无关。
        </p>
      </PopoverContent>
    </Popover>
  )
}
