"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Check, Loader2, Plus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { getHubData } from "@protocol/hub-data"
import type { NewSubscription } from "@protocol/subscription"
import { flowbackToast } from "./flowback-toast"

/**
 * 订阅开关 (反馈原语) —— 把「发现」里的来源 (发布者 / 实体 / peer) 订阅回 home 中枢。
 * 经 protocol 的 HubDataPort 写入 (本地优先, 浏览器 IndexedDB), app 不直接依赖 core 存储。
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
  // null = 尚未读出本地订阅状态 (按钮先禁用, 避免误判已/未订阅)
  const [subscribed, setSubscribed] = React.useState<boolean | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [pulse, setPulse] = React.useState(false)

  React.useEffect(() => {
    let alive = true
    getHubData()
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
      const hub = getHubData()
      if (subscribed) {
        await hub.removeSubscription(type, key)
        setSubscribed(false)
        toast.success(`已取消订阅 ${title}`)
      } else {
        await hub.addSubscription(sub)
        setSubscribed(true)
        flowbackToast(`已订阅 ${title}`, () => router.push("/home/subscriptions"))
        setPulse(true)
        setTimeout(() => setPulse(false), 600)
      }
    } catch {
      toast.error("操作失败，请重试")
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
      className={cn("shrink-0", pulse && "animate-flowback motion-reduce:animate-none", className)}
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : subscribed ? (
        <Check className="h-4 w-4" />
      ) : (
        <Plus className="h-4 w-4" />
      )}
      {subscribed ? "已订阅" : "订阅"}
    </Button>
  )
}

export default SubscribeButton
