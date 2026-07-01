"use client"

import * as React from "react"
import { listSubscriptions } from "@/files/stores/subscriptions-store"
import { countBookmarks } from "@/files/stores/bookmarks-store"
import { countFiles } from "@/files/stores/files-store"
import { onFilesUpdated } from "@protocol/flowback"

/**
 * 「我的」内容计数 (关注 + 书签 + 文件)。每次写入 (FILES_UPDATED / SUBSCRIPTIONS_SYNCED) 实时刷新,
 * 数值增加时 flash 一下 (供「我的」导航项挂数量 badge)。原 nav-link 内联逻辑抽出, 供 rail / 底栏共用。
 */
export function useNodeCount(): { count: number | null; flash: boolean } {
  const [count, setCount] = React.useState<number | null>(null)
  const [flash, setFlash] = React.useState(false)
  const prev = React.useRef<number | null>(null)

  React.useEffect(() => {
    let alive = true
    let flashTimer: ReturnType<typeof setTimeout> | undefined
    async function load() {
      try {
        // 文件走 count() (不载入 Blob); 书签/关注含删除标记, 需过滤后计数 (countBookmarks 全扫描过滤, 关注 listSubscriptions 过滤)。
        const [subs, bmCount, fileCount] = await Promise.all([
          listSubscriptions(),
          countBookmarks(),
          countFiles(),
        ])
        if (!alive) return
        const n = subs.length + bmCount + fileCount
        if (prev.current !== null && n > prev.current) {
          setFlash(true)
          clearTimeout(flashTimer) // 快速连续关注时不让多枚计时器叠加
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
    const off = onFilesUpdated(load)
    return () => {
      alive = false
      clearTimeout(flashTimer)
      off()
    }
  }, [])

  return { count, flash }
}
