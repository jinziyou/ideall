"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Check, Loader2, Plus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/ui/button"
import { cn } from "@/lib/utils"
import { getFilesPort } from "@protocol/files"
import type { NewSubscription } from "@protocol/subscription"
import { undoableToast } from "@/lib/undo-toast"
import { flowbackToast } from "./flowback-toast"

/**
 * 关注开关 (基础组件) —— 把「发现」里的来源 (发布者 / 实体 / 社区用户) 关注回「我的」(home)。
 * 经 protocol 的 FilesPort 写入 (本地优先, 浏览器 IndexedDB), 发现模块不直接依赖底层存储。
 * 可在 info / community 等模块复用。
 */
export function SubscribeButton({
  sub,
  size = "sm",
  className,
}: {
  sub: NewSubscription
  size?: "sm" | "default"
  className?: string
}) {
  const { type, key, title } = sub
  const router = useRouter()
  // null = 尚未读出本地关注状态 (按钮先禁用, 避免误判已/未关注)
  const [subscribed, setSubscribed] = React.useState<boolean | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [pulse, setPulse] = React.useState(false)

  React.useEffect(() => {
    let alive = true
    getFilesPort()
      .isSubscribed(type, key)
      .then((v) => alive && setSubscribed(v))
      .catch(() => alive && setSubscribed(false))
    return () => {
      alive = false
    }
  }, [type, key])

  async function toggle() {
    if (subscribed === null || busy) return
    setBusy(true)
    try {
      const filesPort = getFilesPort()
      if (subscribed) {
        await filesPort.removeSubscription(type, key)
        setSubscribed(false)
        // 关注是长期积累的资产, 误点取消可一键撤销 (触屏无 hover, 故用可撤销 toast 而非悬停态)
        undoableToast(`已取消关注 ${title}`, () =>
          getFilesPort()
            .addSubscription(sub)
            .then(() => setSubscribed(true)),
        )
      } else {
        await filesPort.addSubscription(sub)
        setSubscribed(true)
        flowbackToast(`已关注 ${title}`, () => router.push("/home/subscriptions"))
        setPulse(true)
        setTimeout(() => setPulse(false), 600)
      }
    } catch {
      toast.error(subscribed ? "取消关注失败，请重试" : "关注失败，请重试")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button
      type="button"
      size={size}
      variant={subscribed ? "secondary" : "default"}
      disabled={subscribed === null || busy}
      onClick={toggle}
      aria-label={subscribed ? `取消关注 ${title}` : `关注 ${title}`}
      title={subscribed ? "已关注 · 点击取消" : undefined}
      className={cn("shrink-0", pulse && "animate-flowback motion-reduce:animate-none", className)}
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : subscribed ? (
        <Check className="h-4 w-4" />
      ) : (
        <Plus className="h-4 w-4" />
      )}
      {subscribed ? "已关注" : "关注"}
    </Button>
  )
}
