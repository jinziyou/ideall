"use client"

import * as React from "react"
import { Bookmark, Loader2 } from "lucide-react"
import { toast } from "sonner"
import type { AgentContextSource } from "@/lib/agent-context-tray"
import { Button } from "@/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog"
import { Label } from "@/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select"
import { Textarea } from "@/ui/textarea"
import {
  AGENT_BOOKMARK_DESCRIPTION_LIMIT,
  loadAgentBookmarkTarget,
  type AgentBookmarkDescriptionDraft,
  type AgentBookmarkTargetSnapshot,
} from "../lib/agent-artifact"
import type { AgentArtifactReceipt, AgentMessage } from "../lib/model"

type BookmarkSource = Extract<AgentContextSource, { type: "node" }> & { kind: "bookmark" }

function suggestedDescription(current: string, answer: string): string {
  const boundedAnswer = answer.trim().slice(0, AGENT_BOOKMARK_DESCRIPTION_LIMIT)
  const appended = current.trim() ? `${current.trim()}\n\n${boundedAnswer}` : boundedAnswer
  return appended.length <= AGENT_BOOKMARK_DESCRIPTION_LIMIT ? appended : boundedAnswer
}

function SaveBookmarkForm({
  message,
  sources,
  onSave,
  onClose,
}: {
  message: AgentMessage
  sources: readonly BookmarkSource[]
  onSave: (messageId: string, draft: AgentBookmarkDescriptionDraft) => Promise<AgentArtifactReceipt>
  onClose: () => void
}) {
  const [sourceKey, setSourceKey] = React.useState(sources[0]?.key ?? "")
  const [target, setTarget] = React.useState<AgentBookmarkTargetSnapshot | null>(null)
  const [description, setDescription] = React.useState("")
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const selected = sources.find((source) => source.key === sourceKey) ?? null

  React.useEffect(() => {
    let alive = true
    setLoading(true)
    setError("")
    setTarget(null)
    if (!selected) {
      setLoading(false)
      return () => {
        alive = false
      }
    }
    void loadAgentBookmarkTarget(selected).then(
      (snapshot) => {
        if (!alive) return
        setTarget(snapshot)
        setDescription(suggestedDescription(snapshot.description, message.content))
        setLoading(false)
      },
      (loadError) => {
        if (!alive) return
        setError(loadError instanceof Error ? loadError.message : String(loadError))
        setLoading(false)
      },
    )
    return () => {
      alive = false
    }
  }, [message.content, selected])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!target || !description.trim() || saving) return
    setSaving(true)
    try {
      const receipt = await onSave(message.id, { target, description })
      toast.success("已更新书签描述", { description: receipt.title })
      onClose()
    } catch (saveError) {
      toast.error("更新书签失败", {
        description: saveError instanceof Error ? saveError.message : String(saveError),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>写入书签描述</DialogTitle>
        <DialogDescription>
          只能选择本次回答实际引用的书签。提交绑定当前版本；书签变化后会拒绝覆盖。
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5">
        <Label htmlFor={`agent-bookmark-target-${message.id}`}>目标书签</Label>
        <Select value={sourceKey} onValueChange={setSourceKey} disabled={saving}>
          <SelectTrigger id={`agent-bookmark-target-${message.id}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sources.map((source) => (
              <SelectItem key={source.key} value={source.key}>
                {source.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在读取当前书签版本…
        </p>
      ) : error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      ) : target ? (
        <>
          <p className="truncate text-xs text-muted-foreground" title={target.url}>
            {target.url}
          </p>
          <div className="space-y-1.5">
            <Label htmlFor={`agent-bookmark-description-${message.id}`}>提交内容预览</Label>
            <Textarea
              id={`agent-bookmark-description-${message.id}`}
              value={description}
              maxLength={AGENT_BOOKMARK_DESCRIPTION_LIMIT}
              rows={12}
              className="max-h-[42dvh] resize-y text-sm leading-relaxed"
              onChange={(event) => setDescription(event.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              默认在现有描述后追加；超出上限时改为仅使用本次回答。此处展示的是最终完整值。
            </p>
          </div>
        </>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>
          取消
        </Button>
        <Button type="submit" disabled={saving || !target || !description.trim()}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bookmark className="h-4 w-4" />}
          确认更新
        </Button>
      </DialogFooter>
    </form>
  )
}

export default function AgentBookmarkSaveDialog({
  message,
  sources,
  onSave,
}: {
  message: AgentMessage
  sources: readonly BookmarkSource[]
  onSave: (messageId: string, draft: AgentBookmarkDescriptionDraft) => Promise<AgentArtifactReceipt>
}) {
  const [open, setOpen] = React.useState(false)
  if (sources.length === 0) return null
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <Bookmark className="h-3.5 w-3.5" />
        写入书签描述
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          {open ? (
            <SaveBookmarkForm
              message={message}
              sources={sources}
              onSave={onSave}
              onClose={() => setOpen(false)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
