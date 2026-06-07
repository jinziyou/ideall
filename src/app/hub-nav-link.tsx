"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { listSubscriptions } from "./home/lib/subscriptions-store"
import { listBookmarks } from "./home/lib/bookmarks-store"
import { listFiles } from "./home/lib/files-store"
import { HUB_UPDATED } from "./home/lib/flowback"
import { HUB_HREF, HUB_LABEL } from "./nav-config"

/**
 * 头部主项「我的空间」—— 中枢的唯一主导航项。
 * 挂一枚回流计数 badge (订阅 + 书签); 每次回流 (HUB_UPDATED) 实时刷新, 增加时闪一下。
 */
export default function HubNavLink() {
  const pathname = usePathname()
  const active = pathname === HUB_HREF || pathname.startsWith(HUB_HREF + "/")
  const [count, setCount] = React.useState<number | null>(null)
  const [flash, setFlash] = React.useState(false)
  const prev = React.useRef<number | null>(null)

  React.useEffect(() => {
    let alive = true
    async function load() {
      try {
        const [subs, bms, files] = await Promise.all([
          listSubscriptions(),
          listBookmarks(),
          listFiles(),
        ])
        if (!alive) return
        const n = subs.length + bms.length + files.length
        if (prev.current !== null && n > prev.current) {
          setFlash(true)
          setTimeout(() => {
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
    const onUpdate = () => load()
    window.addEventListener(HUB_UPDATED, onUpdate)
    window.addEventListener("wonita:subscriptions-synced", onUpdate)
    return () => {
      alive = false
      window.removeEventListener(HUB_UPDATED, onUpdate)
      window.removeEventListener("wonita:subscriptions-synced", onUpdate)
    }
  }, [])

  return (
    <Link
      href={HUB_HREF}
      className={cn(
        "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition-colors",
        active ? "text-foreground" : "text-foreground/80 hover:text-foreground",
      )}
    >
      <span className={cn("border-b-2 pb-0.5", active ? "border-pop" : "border-transparent")}>
        {HUB_LABEL}
      </span>
      {count !== null && count > 0 && (
        <span
          className={cn(
            "inline-grid h-[18px] min-w-[18px] place-items-center rounded-full bg-pop px-1 text-[10px] font-bold tabular-nums text-pop-foreground",
            flash && "animate-flowback motion-reduce:animate-none",
          )}
        >
          {count}
        </span>
      )}
    </Link>
  )
}
