"use client"

import * as React from "react"
import { Loader2, Pin } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { addSubscription, isSubscribed, removeSubscription } from "./lib/subscriptions-store"

/**
 * 「钉到 home」开关 —— 把工具 (搜索引擎 / AI / 导航站) 订阅为 home 的快捷启动项。
 * 本地优先: 写浏览器 IndexedDB。图标按钮形态, 作为工具卡 (button/a) 的角标叠加, 不嵌套于卡内。
 */
export function PinToolButton({
  name,
  url,
  className,
}: {
  name: string
  /** 启动 URL, 兼作订阅去重键 */
  url: string
  className?: string
}) {
  const [pinned, setPinned] = React.useState<boolean | null>(null)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    let alive = true
    isSubscribed("tool", url)
      .then((v) => alive && setPinned(v))
      .catch(() => alive && setPinned(false))
    return () => {
      alive = false
    }
  }, [url])

  async function toggle(e: React.MouseEvent) {
    // 角标与卡片是兄弟节点, 这里再挡一道, 确保不触发卡片的跳转
    e.preventDefault()
    e.stopPropagation()
    if (pinned === null || busy) return
    setBusy(true)
    try {
      if (pinned) {
        await removeSubscription("tool", url)
        setPinned(false)
        toast.success(`已取消钉住 ${name}`)
      } else {
        await addSubscription({ type: "tool", key: url, title: name })
        setPinned(true)
        toast.success(`已钉到 home · ${name}`)
      }
    } catch {
      toast.error("操作失败, 请重试")
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pinned === null || busy}
      title={pinned ? "取消钉住" : "钉到 home"}
      aria-label={pinned ? `取消钉住 ${name}` : `钉到 home ${name}`}
      className={cn(
        "rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50",
        pinned && "text-primary",
        className,
      )}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Pin className={cn("h-3.5 w-3.5", pinned && "fill-current")} />
      )}
    </button>
  )
}

export default PinToolButton
