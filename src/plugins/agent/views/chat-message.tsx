"use client"

import * as React from "react"
import {
  BookOpen,
  Bookmark,
  CheckCircle2,
  ExternalLink,
  Eye,
  ListTodo,
  Lock,
  RotateCcw,
  Trash2,
  Wrench,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { getUiActions } from "@/lib/ui-actions"
import { isAgentContextSource, type AgentContextSource } from "@/lib/agent-context-tray"
import type {
  AgentBookmarkDescriptionDraft,
  AgentNoteDraft,
  AgentTaskArtifactDraft,
} from "../lib/agent-artifact"
import {
  isAgentArtifactReceipt,
  isUndoableAgentArtifact,
  type AgentArtifactReceipt,
  type AgentMessage,
} from "../lib/model"
import AgentBookmarkSaveDialog from "./agent-bookmark-save-dialog"
import AgentNoteSaveDialog from "./agent-note-save-dialog"
import AgentTaskSaveDialog from "./agent-task-save-dialog"

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

function openSource(source: AgentContextSource): void {
  const actions = getUiActions()
  if (source.type === "node") actions?.openTab(source.kind, source.id, source.title)
  else void actions?.openExternal?.(source.url)
}

function openArtifact(receipt: AgentArtifactReceipt): void {
  if (receipt.kind === "task" && receipt.undoneAt !== undefined) return
  const kind =
    receipt.kind === "task"
      ? "thread"
      : receipt.kind === "bookmark-description"
        ? "bookmark"
        : "note"
  getUiActions()?.openTab(kind, receipt.nodeId, receipt.title)
}

function artifactLabel(receipt: AgentArtifactReceipt): string {
  if (receipt.undoneAt !== undefined) return `已撤销：${receipt.title}`
  if (receipt.kind === "task") return `任务 · ${receipt.workspaceName}：${receipt.title}`
  if (receipt.kind === "bookmark-description") return `已更新书签：${receipt.title}`
  return `已写入：${receipt.title}`
}

function ChatMessage({
  message,
  streaming,
  compact = false,
  onSaveNote,
  onSaveTask,
  onSaveBookmark,
  onUndoArtifact,
  actionsDisabled = false,
}: {
  message: AgentMessage
  streaming?: boolean
  compact?: boolean
  onSaveNote?: (messageId: string, draft: AgentNoteDraft) => Promise<AgentArtifactReceipt>
  onSaveTask?: (messageId: string, draft: AgentTaskArtifactDraft) => Promise<AgentArtifactReceipt>
  onSaveBookmark?: (
    messageId: string,
    draft: AgentBookmarkDescriptionDraft,
  ) => Promise<AgentArtifactReceipt>
  onUndoArtifact?: (messageId: string, receipt: AgentArtifactReceipt) => Promise<void>
  actionsDisabled?: boolean
}) {
  const isUser = message.role === "user"
  const rendered = React.useMemo(
    () => (message.content ? renderContent(message.content) : null),
    [message.content],
  )
  const sources = Array.isArray(message.sources) ? message.sources.filter(isAgentContextSource) : []
  const artifacts = Array.isArray(message.artifacts)
    ? message.artifacts.filter(isAgentArtifactReceipt)
    : []
  const bookmarkSources = sources.filter(
    (source): source is Extract<AgentContextSource, { type: "node" }> & { kind: "bookmark" } =>
      source.type === "node" && source.kind === "bookmark",
  )
  const [undoing, setUndoing] = React.useState<string | null>(null)

  async function undoArtifact(receipt: AgentArtifactReceipt) {
    if (
      actionsDisabled ||
      !onUndoArtifact ||
      !isUndoableAgentArtifact(receipt) ||
      receipt.undoneAt !== undefined
    )
      return
    const key = `${receipt.kind}:${receipt.nodeId}`
    setUndoing(key)
    try {
      await onUndoArtifact(message.id, receipt)
      toast.success(receipt.kind === "task" ? "已撤销任务创建" : "已恢复原书签描述")
    } catch (error) {
      toast.error("撤销失败，目标可能已被继续编辑", {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setUndoing(null)
    }
  }

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
        {!isUser && !streaming && sources.length > 0 ? (
          <div className="mt-3 border-t pt-2.5">
            <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">
              来源 {sources.length}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {sources.map((source) => (
                <button
                  key={source.key}
                  type="button"
                  onClick={() => openSource(source)}
                  className="inline-flex max-w-full items-center gap-1 rounded-md border bg-card px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  {source.type === "node" ? (
                    <BookOpen className="h-3 w-3 shrink-0" />
                  ) : (
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  )}
                  <span className="max-w-48 truncate">{source.title}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {!isUser &&
        !streaming &&
        message.content.trim() &&
        ((!actionsDisabled && (onSaveNote || onSaveTask || onSaveBookmark)) ||
          artifacts.length > 0) ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t pt-2">
            {!actionsDisabled && onSaveNote ? (
              <AgentNoteSaveDialog message={message} onSave={onSaveNote} />
            ) : null}
            {!actionsDisabled && onSaveTask ? (
              <AgentTaskSaveDialog message={message} onSave={onSaveTask} />
            ) : null}
            {!actionsDisabled && onSaveBookmark && bookmarkSources.length > 0 ? (
              <AgentBookmarkSaveDialog
                message={message}
                sources={bookmarkSources}
                onSave={onSaveBookmark}
              />
            ) : null}
            {artifacts.map((receipt) => (
              <span
                key={`${receipt.kind}:${receipt.nodeId}`}
                className="inline-flex h-7 max-w-full items-center rounded-md border bg-card text-xs"
              >
                <button
                  type="button"
                  onClick={() => openArtifact(receipt)}
                  disabled={receipt.kind === "task" && receipt.undoneAt !== undefined}
                  className="inline-flex h-full min-w-0 items-center gap-1 px-2 text-success hover:text-foreground disabled:text-muted-foreground"
                  title={receipt.undoneAt === undefined ? "打开产物" : "该写操作已撤销"}
                >
                  {receipt.kind === "task" ? (
                    <ListTodo className="h-3.5 w-3.5 shrink-0" />
                  ) : receipt.kind === "bookmark-description" ? (
                    <Bookmark className="h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  )}
                  <span className="max-w-48 truncate">{artifactLabel(receipt)}</span>
                </button>
                {onUndoArtifact &&
                !actionsDisabled &&
                isUndoableAgentArtifact(receipt) &&
                receipt.undoneAt === undefined ? (
                  <button
                    type="button"
                    disabled={undoing !== null}
                    onClick={() => void undoArtifact(receipt)}
                    className="inline-flex h-full items-center gap-1 border-l px-2 text-muted-foreground hover:text-foreground disabled:opacity-50"
                    title="仅在目标未被继续编辑时撤销"
                  >
                    <RotateCcw className="h-3 w-3" />
                    撤销
                  </button>
                ) : null}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default React.memo(ChatMessage)
