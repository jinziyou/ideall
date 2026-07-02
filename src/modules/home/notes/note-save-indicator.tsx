"use client"

// 笔记保存状态指示 (编辑器头部右侧): 保存中 / 已保存 / 保存失败+重试。
// 订阅写队列的状态源 (note-write-queue), 与组件树解耦 —— 落库真相只有队列知道。
import * as React from "react"
import { AlertCircle, Check, Loader2 } from "lucide-react"
import {
  getNoteSaveStatus,
  retryNoteSaves,
  subscribeNoteSaveStatus,
} from "@/files/note-write-queue"

export default function NoteSaveIndicator({ noteId }: { noteId: string }) {
  const status = React.useSyncExternalStore(
    subscribeNoteSaveStatus,
    () => getNoteSaveStatus(noteId),
    () => getNoteSaveStatus(noteId),
  )

  if (status.state === "idle") return null
  if (status.state === "saving") {
    return (
      <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        保存中…
      </span>
    )
  }
  if (status.state === "error") {
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-destructive">
        <AlertCircle className="h-3 w-3" />
        保存失败
        <button
          type="button"
          onClick={retryNoteSaves}
          className="rounded px-1 underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          重试
        </button>
      </span>
    )
  }
  return (
    <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground/70">
      <Check className="h-3 w-3" />
      已保存
    </span>
  )
}
