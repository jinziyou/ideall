"use client"

import * as React from "react"
import { BookmarkCheck, BookmarkPlus, Loader2 } from "lucide-react"
import type { CaptureBookmarkInput } from "@protocol/capture"
import { captureBookmarkToMine } from "@/filesystem/capture-bookmark"
import { safeHref } from "@/lib/safe-url"
import { cn } from "@/lib/utils"
import {
  captureBookmarkFailureToast,
  captureBookmarkSuccessToast,
} from "./capture-bookmark-feedback"

/** 新闻、社区和普通外链共用的一键捕获按钮。 */
export function CaptureLinkButton({
  title,
  url,
  description,
  favicon,
  className,
}: CaptureBookmarkInput & { className?: string }) {
  const [state, setState] = React.useState<"idle" | "saving" | "saved">("idle")
  const valid = Boolean(safeHref(url))

  React.useEffect(() => setState("idle"), [url])

  async function capture(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    if (!valid || state !== "idle") return
    setState("saving")
    try {
      const result = await captureBookmarkToMine({ title, url, description, favicon })
      setState("saved")
      captureBookmarkSuccessToast({ status: result.status, title: result.bookmark.title })
    } catch {
      setState("idle")
      captureBookmarkFailureToast()
    }
  }

  if (!valid) return null
  const saved = state === "saved"
  return (
    <button
      type="button"
      onClick={capture}
      disabled={state !== "idle"}
      title={saved ? "已保存到我的" : "保存到我的"}
      aria-label={saved ? `${title} 已保存到我的` : `保存 ${title} 到我的`}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-70 pointer-coarse:p-2",
        saved && "text-primary",
        className,
      )}
    >
      {state === "saving" ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : saved ? (
        <BookmarkCheck className="h-3.5 w-3.5" />
      ) : (
        <BookmarkPlus className="h-3.5 w-3.5" />
      )}
    </button>
  )
}
