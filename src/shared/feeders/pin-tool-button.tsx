"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Loader2, Pin } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { getFilesPort } from "@protocol/files"
import { undoableToast } from "@/lib/undo-toast"
import { flowbackToast } from "./flowback-toast"

/**
 * 「钉到「我的」」开关 (反馈原语) —— 把工具 (搜索引擎 / AI / 导航站) 关注为 home 的快捷启动项。
 * 经 protocol 的 FilesPort 写入 (本地优先)。图标按钮形态, 作为工具卡的角标叠加。
 */
export function PinToolButton({
  name,
  url,
  className,
}: {
  name: string
  /** 启动 URL, 兼作关注去重键 */
  url: string
  className?: string
}) {
  const router = useRouter()
  const [pinned, setPinned] = React.useState<boolean | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [pulse, setPulse] = React.useState(false)

  React.useEffect(() => {
    let alive = true
    getFilesPort()
      .isSubscribed("tool", url)
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
      const hub = getFilesPort()
      if (pinned) {
        await hub.removeSubscription("tool", url)
        setPinned(false)
        // 误点取消可一键撤销 (addSubscription 复活墓碑: 清 deletedAt, 保留 createdAt)
        undoableToast(`已取消钉住 ${name}`, () =>
          getFilesPort()
            .addSubscription({ type: "tool", key: url, title: name })
            .then(() => setPinned(true)),
        )
      } else {
        await hub.addSubscription({ type: "tool", key: url, title: name })
        setPinned(true)
        flowbackToast(`已钉住 ${name}`, () => router.push("/home/subscriptions"))
        setPulse(true)
        setTimeout(() => setPulse(false), 600)
      }
    } catch {
      toast.error(pinned ? "取消钉住失败，请重试" : "钉住失败，请重试")
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pinned === null || busy}
      title={pinned ? "取消钉住" : "钉到「我的」"}
      aria-label={pinned ? `取消钉住 ${name}` : `钉到「我的」 ${name}`}
      className={cn(
        // 触屏放大命中区 (角标叠在卡角, 桌面保持紧凑)
        "rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50 pointer-coarse:p-2",
        pinned && "text-pop",
        pulse && "animate-flowback motion-reduce:animate-none",
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
