"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { BookmarkPlus, FileText, Network, Plus, Rss } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { openExternal } from "@/lib/safe-url"
import { invokeResourceAction } from "@/vfs/registry"
import type { SaveToMineResult } from "@/vfs/save-to-mine-projector"
import { flowbackToast } from "./flowback-toast"

/**
 * 统一的「加入我的」基础组件 (feeders) —— 把发现模块上的任意条目 (文章 / 事件 / 链接) 加入本地的「我的」。
 * 按传入的能力渲染菜单项: 收藏到书签 / 关注发布者; 另带原文 / 全面报道 直达。
 * 经 VFS save-to-mine action 写入, 让保存映射集中在资源层。
 */
export function SaveToMine({
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
  const router = useRouter()
  const [pulse, setPulse] = React.useState(false)
  function pop() {
    setPulse(true)
    setTimeout(() => setPulse(false), 600)
  }

  async function doBookmark() {
    if (!bookmark) return
    try {
      const result = (await invokeResourceAction(
        { scheme: "browser", kind: "page", id: bookmark.url },
        "save-to-mine",
        bookmark,
        { actor: "ui", permissions: [] },
      )) as SaveToMineResult
      if (result.kind === "bookmark" && result.existed) {
        toast.info("已在书签中")
        return
      }
      pop()
      flowbackToast("已收藏到书签", () => router.push("/home/bookmarks"))
    } catch {
      toast.error("收藏失败，请重试")
    }
  }

  async function doSubscribe() {
    if (!publisher?.domain) return
    try {
      const title = publisher.name || publisher.domain
      const result = (await invokeResourceAction(
        { scheme: "info", kind: "publisher", id: publisher.domain },
        "save-to-mine",
        { domain: publisher.domain, title },
        { actor: "ui", permissions: [] },
      )) as SaveToMineResult
      if (result.kind === "subscription" && result.existed) {
        toast.info("已关注该发布者")
        return
      }
      pop()
      flowbackToast(`已关注 ${title}`, () => router.push("/home/subscriptions"))
    } catch {
      toast.error("关注失败，请重试")
    }
  }

  const pulseCls = pulse ? "animate-flowback motion-reduce:animate-none" : ""
  const trigger =
    variant === "icon" ? (
      <Button
        variant="ghost"
        size="icon"
        className={cn("h-8 w-8", pulseCls, className)}
        title="加入「我的」"
      >
        <Plus className="h-4 w-4" />
        <span className="sr-only">加入「我的」</span>
      </Button>
    ) : (
      <Button size="sm" className={cn("gap-1.5", pulseCls, className)}>
        <Plus className="h-4 w-4" />
        加入「我的」
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
            关注发布者
          </DropdownMenuItem>
        )}
        {hasFlow && hasLinks && <DropdownMenuSeparator />}
        {openUrl && (
          <DropdownMenuItem onSelect={() => openExternal(openUrl)}>
            <FileText className="mr-2 h-4 w-4" />
            原文
          </DropdownMenuItem>
        )}
        {analysisUrl && (
          <DropdownMenuItem onSelect={() => router.push(analysisUrl)}>
            <Network className="mr-2 h-4 w-4" />
            全面报道
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
