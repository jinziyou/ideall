"use client"

import * as React from "react"
import { ListTodo, Loader2 } from "lucide-react"
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select"
import { Textarea } from "@/ui/textarea"
import {
  AGENT_NOTE_BODY_LIMIT,
  AGENT_NOTE_TITLE_LIMIT,
  agentNoteDraftForMessage,
  type AgentTaskArtifactDraft,
} from "../lib/agent-artifact"
import {
  getServerWorkspacesState,
  getWorkspacesState,
  subscribeWorkspaces,
} from "../lib/agent-workspace"
import type { AgentArtifactReceipt, AgentMessage } from "../lib/model"

function SaveTaskForm({
  message,
  onSave,
  onClose,
}: {
  message: AgentMessage
  onSave: (messageId: string, draft: AgentTaskArtifactDraft) => Promise<AgentArtifactReceipt>
  onClose: () => void
}) {
  const state = React.useSyncExternalStore(
    subscribeWorkspaces,
    getWorkspacesState,
    getServerWorkspacesState,
  )
  const initial = React.useMemo(() => agentNoteDraftForMessage(message), [message])
  const initialWorkspaceId = state.workspaces.some((workspace) => workspace.id === state.activeId)
    ? state.activeId
    : (state.workspaces[0]?.id ?? "")
  const [workspaceId, setWorkspaceId] = React.useState(initialWorkspaceId)
  const [title, setTitle] = React.useState(initial.title)
  const [body, setBody] = React.useState(initial.body)
  const [saving, setSaving] = React.useState(false)
  const workspace = state.workspaces.find((candidate) => candidate.id === workspaceId)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!workspace || !title.trim() || !body.trim() || saving) return
    setSaving(true)
    try {
      const receipt = await onSave(message.id, {
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        title,
        body,
      })
      toast.success("已创建 AI 任务", { description: `${workspace.name} · ${receipt.title}` })
      onClose()
    } catch (error) {
      toast.error("创建任务失败", {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>把 AI 回答转为任务</DialogTitle>
        <DialogDescription>
          将创建独立任务线程并保留本次回答与来源。任务被继续编辑后，旧回执不能覆盖式撤销。
        </DialogDescription>
      </DialogHeader>
      {state.workspaces.length === 0 ? (
        <p className="rounded-md border border-warning/30 bg-warning/5 p-3 text-sm text-muted-foreground">
          还没有可用的 Agent 工作区，请先在“空间”中创建一个工作区。
        </p>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label htmlFor={`agent-task-workspace-${message.id}`}>工作区</Label>
            <Select value={workspaceId} onValueChange={setWorkspaceId}>
              <SelectTrigger id={`agent-task-workspace-${message.id}`}>
                <SelectValue placeholder="选择工作区" />
              </SelectTrigger>
              <SelectContent>
                {state.workspaces.map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`agent-task-title-${message.id}`}>任务标题</Label>
            <Input
              id={`agent-task-title-${message.id}`}
              value={title}
              maxLength={AGENT_NOTE_TITLE_LIMIT}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`agent-task-body-${message.id}`}>任务资料预览</Label>
            <Textarea
              id={`agent-task-body-${message.id}`}
              value={body}
              maxLength={AGENT_NOTE_BODY_LIMIT}
              rows={12}
              className="max-h-[42dvh] resize-y font-mono text-xs leading-relaxed"
              onChange={(event) => setBody(event.target.value)}
            />
          </div>
        </>
      )}
      <DialogFooter>
        <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>
          取消
        </Button>
        <Button type="submit" disabled={saving || !workspace || !title.trim() || !body.trim()}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListTodo className="h-4 w-4" />}
          确认创建
        </Button>
      </DialogFooter>
    </form>
  )
}

export default function AgentTaskSaveDialog({
  message,
  onSave,
}: {
  message: AgentMessage
  onSave: (messageId: string, draft: AgentTaskArtifactDraft) => Promise<AgentArtifactReceipt>
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
        <ListTodo className="h-3.5 w-3.5" />
        转为任务
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          {open ? (
            <SaveTaskForm message={message} onSave={onSave} onClose={() => setOpen(false)} />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
