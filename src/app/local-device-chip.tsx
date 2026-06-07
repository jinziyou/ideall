"use client"

import * as React from "react"
import { Lock } from "lucide-react"
import { cn } from "@/lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { getSyncCode, subscribeSyncCode } from "@/lib/sync-code"

function getServerSnapshot(): string | null {
  return null
}

/** 本地·此设备 所有权药丸 —— 把 local-first 从论证变成持续可见的身份。 */
export default function LocalDeviceChip() {
  const code = React.useSyncExternalStore(subscribeSyncCode, getSyncCode, getServerSnapshot)
  const synced = Boolean(code)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Lock className="h-3.5 w-3.5" />
          <span className="hidden lg:inline">本地 · 此设备</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Lock className="h-4 w-4" />
          本地 · 此设备
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          你的订阅、书签、文件与对话都存在这台设备的浏览器里, 默认<b className="font-medium text-foreground">不上传服务器</b>。
        </p>
        <div className="mt-3 flex items-center justify-between rounded-md border bg-muted/40 px-2.5 py-2">
          <span className="text-xs">跨端同步</span>
          <span className={cn("text-xs font-medium", synced ? "text-foreground" : "text-muted-foreground")}>
            {synced ? "已开启 (端到端加密)" : "未开启"}
          </span>
        </div>
        <a
          href="/home/subscriptions"
          className="mt-2.5 inline-block text-xs font-medium text-foreground hover:underline"
        >
          管理跨端同步 →
        </a>
      </PopoverContent>
    </Popover>
  )
}
