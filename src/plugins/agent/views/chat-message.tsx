"use client"

import * as React from "react"
import { Eye, Lock, Trash2, Wrench, X } from "lucide-react"
import { cn } from "@/lib/utils"
import type { AgentMessage } from "../lib/model"

function toolKind(name: string): "write" | "delete" | "read" {
  if (/^(remove_|delete_)/.test(name)) return "delete"
  if (/^(add_|save_|create_|update_|set_|put_|publish)/.test(name)) return "write"
  return "read"
}

const TOOL_BADGE = {
  write: { Icon: Lock, label: "已写入本机", cls: "text-success" },
  delete: { Icon: Trash2, label: "已从本机删除", cls: "text-destructive" },
  read: { Icon: Eye, label: "仅读取", cls: "text-muted-foreground" },
} as const

function renderContent(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  const fence = /```[\w-]*\n?([\s\S]*?)```/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = fence.exec(text)) !== null) {
    if (m.index > last) {
      parts.push(
        <span key={i++} className="whitespace-pre-wrap break-words">
          {text.slice(last, m.index)}
        </span>,
      )
    }
    parts.push(
      <pre
        key={i++}
        className="my-2 overflow-x-auto rounded-lg bg-muted/60 p-3 text-xs leading-relaxed"
      >
        <code>{m[1].replace(/\n$/, "")}</code>
      </pre>,
    )
    last = fence.lastIndex
  }
  if (last < text.length) {
    parts.push(
      <span key={i++} className="whitespace-pre-wrap break-words">
        {text.slice(last)}
      </span>,
    )
  }
  return parts
}

function ChatMessage({
  message,
  streaming,
  compact = false,
}: {
  message: AgentMessage
  streaming?: boolean
  compact?: boolean
}) {
  const isUser = message.role === "user"
  const rendered = React.useMemo(
    () => (message.content ? renderContent(message.content) : null),
    [message.content],
  )

  return (
    <div className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "text-sm leading-relaxed",
          compact ? "max-w-full" : "max-w-[88%]",
          isUser
            ? "rounded-2xl rounded-br-md bg-primary/10 px-3.5 py-2.5 text-foreground"
            : "px-0.5 py-0.5 text-foreground",
        )}
      >
        {!isUser && message.toolEvents && message.toolEvents.length > 0 && (
          <div className="mb-3 space-y-1.5">
            {message.toolEvents.map((ev, i) => {
              const badge = TOOL_BADGE[toolKind(ev.name)]
              return (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-[13px]"
                >
                  <Wrench className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    <span className="font-mono text-foreground">{ev.name}</span>
                    {ev.summary ? ` · ${ev.summary}` : ""}
                  </span>
                  {ev.ok ? (
                    <span
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1 text-[11px] font-medium",
                        badge.cls,
                      )}
                    >
                      <badge.Icon className="h-3 w-3" />
                      {badge.label}
                    </span>
                  ) : (
                    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-destructive">
                      <X className="h-3 w-3" />
                      失败
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
        {rendered ?? (streaming ? <span className="text-muted-foreground">思考中…</span> : null)}
        {streaming && message.content && (
          <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-foreground/60 align-middle" />
        )}
      </div>
    </div>
  )
}

export default React.memo(ChatMessage)
