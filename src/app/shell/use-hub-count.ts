"use client"

import * as React from "react"
import { listSubscriptions } from "@/app/home/lib/subscriptions-store"
import { countBookmarks } from "@/app/home/lib/bookmarks-store"
import { countFiles } from "@/app/home/lib/files-store"
import { onHubUpdated } from "@protocol/flowback"

/**
 * 中枢回流计数 (订阅 + 书签 + 文件)。每次回流 (HUB_UPDATED / SUBSCRIPTIONS_SYNCED) 实时刷新,
 * 数值增加时 flash 一下 (供「我的」导航项挂回流 badge)。原 hub-nav-link 内联逻辑抽出, 供 rail / 底栏共用。
 */
export function useHubCount(): { count: number | null; flash: boolean } {
  const [count, setCount] = React.useState<number | null>(null)
  const [flash, setFlash] = React.useState(false)
  const prev = React.useRef<number | null>(null)

  React.useEffect(() => {
    let alive = true
    let flashTimer: ReturnType<typeof setTimeout> | undefined
    async function load() {
      try {
        // 文件走 count() (不载入 Blob); 书签/订阅含墓碑, 需过滤后计数 (countBookmarks 全扫描过滤, 订阅 listSubscriptions 过滤)。
        const [subs, bmCount, fileCount] = await Promise.all([
          listSubscriptions(),
          countBookmarks(),
          countFiles(),
        ])
        if (!alive) return
        const n = subs.length + bmCount + fileCount
        if (prev.current !== null && n > prev.current) {
          setFlash(true)
          clearTimeout(flashTimer) // 快速连续回流时不让多枚计时器叠加
          flashTimer = setTimeout(() => {
            if (alive) setFlash(false)
          }, 650)
        }
        prev.current = n
        setCount(n)
      } catch {
        /* 本地读取失败时静默, 不显示 badge */
      }
    }
    load()
    const off = onHubUpdated(load)
    return () => {
      alive = false
      clearTimeout(flashTimer)
      off()
    }
  }, [])

  return { count, flash }
}
