"use client"

import * as React from "react"
import { FilePlus2, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog"
import { Input } from "@/ui/input"
import { Label } from "@/ui/label"
import { Textarea } from "@/ui/textarea"
import {
  AGENT_NOTE_BODY_LIMIT,
  AGENT_NOTE_TITLE_LIMIT,
  agentNoteDraftForMessage,
  type AgentNoteDraft,
} from "../lib/agent-artifact"
import type { AgentArtifactReceipt, AgentMessage } from "../lib/model"

function SaveNoteForm({
  message,
  onSave,
  onClose,
}: {
  message: AgentMessage
  onSave: (messageId: string, draft: AgentNoteDraft) => Promise<AgentArtifactReceipt>
  onClose: () => void
}) {
  const initial = React.useMemo(() => agentNoteDraftForMessage(message), [message])
  const [title, setTitle] = React.useState(initial.title)
  const [body, setBody] = React.useState(initial.body)
  const [saving, setSaving] = React.useState(false)
  const sourceCount = message.sources?.length ?? 0

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!title.trim() || !body.trim() || saving) return
    setSaving(true)
    try {
      const receipt = await onSave(message.id, { title, body })
      toast.success("已保存为笔记", { description: receipt.title })
      onClose()
    } catch (error) {
      toast.error("保存笔记失败", {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>保存 AI 回答为笔记</DialogTitle>
        <DialogDescription>
          确认后才会写入本机。正文可在写入前编辑
          {sourceCount > 0 ? `，并附带 ${sourceCount} 项来源引用` : ""}。
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5">
        <Label htmlFor={`agent-note-title-${message.id}`}>标题</Label>
        <Input
          id={`agent-note-title-${message.id}`}
          value={title}
          maxLength={AGENT_NOTE_TITLE_LIMIT}
          autoFocus
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`agent-note-body-${message.id}`}>正文预览</Label>
        <Textarea
          id={`agent-note-body-${message.id}`}
          value={body}
          maxLength={AGENT_NOTE_BODY_LIMIT}
          rows={14}
          className="max-h-[50dvh] resize-y font-mono text-xs leading-relaxed"
          onChange={(event) => setBody(event.target.value)}
        />
        <p className="text-[11px] text-muted-foreground">
          将添加“AI 生成”标签；来源部分只保存对象引用，不复制原资料正文。
        </p>
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>
          取消
        </Button>
        <Button type="submit" disabled={saving || !title.trim() || !body.trim()}>
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <FilePlus2 className="h-4 w-4" />
          )}
          确认写入
        </Button>
      </DialogFooter>
    </form>
  )
}

export default function AgentNoteSaveDialog({
  message,
  onSave,
}: {
  message: AgentMessage
  onSave: (messageId: string, draft: AgentNoteDraft) => Promise<AgentArtifactReceipt>
}) {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <FilePlus2 className="h-3.5 w-3.5" />
        保存为笔记
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          {open ? (
            <SaveNoteForm message={message} onSave={onSave} onClose={() => setOpen(false)} />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
