"use client"

// 节点查看器: 对话线程 (只读)。自取数 (getThread) + 复用 agent 插件的 ChatMessage 渲染会话记录。
// 只读浏览; 「继续对话」一键回右侧 AI 栏并载入本线程。对话即文件 (§6.5): 把会话作可寻址标签打开。
import * as React from "react"
import { Loader2, MessagesSquare } from "lucide-react"
import { Button } from "@/ui/button"
import type { AgentThread } from "@/plugins/agent/lib/model"
import { getThread } from "@/plugins/agent/lib/agent-store"
import { requestOpenThread } from "@/plugins/agent/lib/agent-panel-bus"
import ChatMessage from "@/plugins/agent/views/chat-message"
import { renameNodeTab, setRightPanel } from "../store"
import type { NodeViewerProps } from "../node-kind-ui"

export default function ThreadViewer({ nodeId }: NodeViewerProps) {
  const [thread, setThread] = React.useState<AgentThread | null>(null)
  const [missing, setMissing] = React.useState(false)

  React.useEffect(() => {
    let alive = true
    getThread(nodeId)
      .then((t) => {
        if (!alive) return
        if (t) {
          setThread(t)
          renameNodeTab({ kind: "thread", id: nodeId }, t.title || "对话")
        } else {
          setMissing(true)
        }
      })
      .catch(() => {
        if (alive) setMissing(true)
      })
    return () => {
      alive = false
    }
  }, [nodeId])

  if (missing) {
    return <div className="p-6 text-sm text-muted-foreground">该对话不存在或已删除。</div>
  }
  if (!thread) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-4 overflow-y-auto p-4">
      <div className="flex shrink-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold" title={thread.title}>
            {thread.title || "对话"}
          </h1>
          <p className="text-xs text-muted-foreground">
            只读对话记录 · {thread.messages.length} 条消息
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          onClick={() => {
            setRightPanel(true)
            requestOpenThread(nodeId)
          }}
        >
          <MessagesSquare className="mr-1.5 h-4 w-4" />
          继续对话
        </Button>
      </div>
      {thread.messages.length === 0 ? (
        <p className="text-sm text-muted-foreground">空对话。</p>
      ) : (
        thread.messages.map((m) => <ChatMessage key={m.id} message={m} streaming={false} />)
      )}
    </div>
  )
}
