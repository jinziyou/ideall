"use client"

import * as React from "react"
import { BookmarkPlus, FileText, Network, Plus, Rss } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { getHubData } from "@protocol/hub-data"

/**
 * 统一回流原语「收入中枢」(反馈原语) —— 把 spoke 上的任意条目 (文章 / 事件 / 链接) 落进本地中枢。
 * 按传入的能力渲染菜单项: 收藏到书签 / 订阅发布者; 另带原文 / 全面报道 直达。
 * 经 protocol 的 HubDataPort 写入, 广播 HUB_UPDATED 让头部计数 +1。
 */
export function SaveToHub({
  bookmark,
  publisher,
  openUrl,
  analysisUrl,
  variant = "button",
  className,
}: {
  bookmark?: { title: string; url: string }
  publisher?: { domain: string; name?: string }
  openUrl?: string
  analysisUrl?: string
  variant?: "button" | "icon"
  className?: string
}) {
  const [pulse, setPulse] = React.useState(false)
  function pop() {
    setPulse(true)
    setTimeout(() => setPulse(false), 600)
  }

  async function doBookmark() {
    if (!bookmark) return
    try {
      const hub = getHubData()
      // 去重: addBookmark 非幂等 (每次新 id), 同一 url 重复点会产生重复书签
      const existing = await hub.listBookmarks()
      if (existing.some((b) => b.url === bookmark.url)) {
        toast.info("已在书签中")
        return
      }
      await hub.addBookmark({ title: bookmark.title, url: bookmark.url })
      pop()
      toast.success("已收藏到书签")
    } catch {
      toast.error("收藏失败, 请重试")
    }
  }

  async function doSubscribe() {
    if (!publisher?.domain) return
    try {
      await getHubData().addSubscription({
        type: "publisher",
        key: publisher.domain,
        title: publisher.name || publisher.domain,
      })
      pop()
      toast.success(`已订阅 ${publisher.name || publisher.domain}`)
    } catch {
      toast.error("订阅失败, 请重试")
    }
  }

  const pulseCls = pulse ? "animate-flowback motion-reduce:animate-none" : ""
  const trigger =
    variant === "icon" ? (
      <Button variant="ghost" size="icon" className={cn("h-8 w-8", pulseCls, className)} title="收入中枢">
        <Plus className="h-4 w-4" />
        <span className="sr-only">收入中枢</span>
      </Button>
    ) : (
      <Button size="sm" className={cn("gap-1.5", pulseCls, className)}>
        <Plus className="h-4 w-4" />
        收入中枢
      </Button>
    )

  const hasFlow = Boolean(bookmark || publisher?.domain)
  const hasLinks = Boolean(openUrl || analysisUrl)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {bookmark && (
          <DropdownMenuItem onSelect={doBookmark}>
            <BookmarkPlus className="mr-2 h-4 w-4" />
            收藏到书签
          </DropdownMenuItem>
        )}
        {publisher?.domain && (
          <DropdownMenuItem onSelect={doSubscribe}>
            <Rss className="mr-2 h-4 w-4" />
            订阅发布者
          </DropdownMenuItem>
        )}
        {hasFlow && hasLinks && <DropdownMenuSeparator />}
        {openUrl && (
          <DropdownMenuItem onSelect={() => window.open(openUrl, "_blank", "noopener,noreferrer")}>
            <FileText className="mr-2 h-4 w-4" />
            原文
          </DropdownMenuItem>
        )}
        {analysisUrl && (
          <DropdownMenuItem onSelect={() => window.open(analysisUrl, "_blank", "noopener,noreferrer")}>
            <Network className="mr-2 h-4 w-4" />
            全面报道
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default SaveToHub
