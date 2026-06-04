"use client"

import * as React from "react"
import { Bot } from "lucide-react"
import { cn } from "@/lib/utils"
import type { AgentMessage } from "../model"

// 轻量富文本: 仅把三反引号代码块单独样式化, 其余按纯文本 (保留换行) 渲染。
// 不引入 markdown 依赖; 系统提示已要求模型避免 # / ** 等记号。
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
        className="my-2 overflow-x-auto rounded-md bg-muted/70 p-3 text-xs leading-relaxed"
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

export default function ChatMessage({
  message,
  streaming,
}: {
  message: AgentMessage
  /** 该条是否正在流式接收 (显示光标) */
  streaming?: boolean
}) {
  const isUser = message.role === "user"
  return (
    <div className={cn("flex gap-3", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Bot className="h-4 w-4" />
        </div>
      )}
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
          isUser ? "bg-primary text-primary-foreground" : "border bg-card",
        )}
      >
        {message.content ? (
          renderContent(message.content)
        ) : streaming ? (
          <span className="text-muted-foreground">思考中…</span>
        ) : null}
        {streaming && message.content && (
          <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-current align-middle" />
        )}
      </div>
    </div>
  )
}
