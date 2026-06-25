"use client"

import * as React from "react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog"
import { Button } from "@/ui/button"
import { Input } from "@/ui/input"
import { Label } from "@/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select"
import {
  AgentSettings,
  DEFAULT_SETTINGS,
  getAgentSettings,
  PROVIDER_PRESETS,
  setAgentSettings,
} from "../lib/agent-settings"

const CUSTOM = "__custom__"

export default function AgentSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>{open && <SettingsForm onClose={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  )
}

function SettingsForm({ onClose }: { onClose: () => void }) {
  const initial = getAgentSettings()
  const [form, setForm] = React.useState<AgentSettings>(initial)

  const presetValue = PROVIDER_PRESETS.find((p) => p.baseURL === form.baseURL)?.label ?? CUSTOM

  function applyPreset(label: string) {
    if (label === CUSTOM) return
    const p = PROVIDER_PRESETS.find((x) => x.label === label)
    if (p) setForm((f) => ({ ...f, baseURL: p.baseURL, model: p.model || f.model }))
  }

  function save() {
    const next: AgentSettings = {
      baseURL: form.baseURL.trim() || DEFAULT_SETTINGS.baseURL,
      model: form.model.trim(),
      apiKey: form.apiKey.trim(),
      includeHomeContext: form.includeHomeContext,
    }
    if (!next.apiKey) {
      toast.error("请填写 API Key")
      return
    }
    if (!next.model) {
      toast.error("请填写模型名")
      return
    }
    setAgentSettings(next)
    toast.success("已保存设置")
    onClose()
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>AI 助手设置</DialogTitle>
        <DialogDescription>自带 API Key，只存本机。服务器不留存密钥与对话内容。</DialogDescription>
      </DialogHeader>

      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label>服务商预设</Label>
          <Select value={presetValue} onValueChange={applyPreset}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROVIDER_PRESETS.map((p) => (
                <SelectItem key={p.label} value={p.label}>
                  {p.label}
                </SelectItem>
              ))}
              <SelectItem value={CUSTOM}>自定义</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="ag-base">API Base URL</Label>
          <Input
            id="ag-base"
            placeholder="https://api.deepseek.com/v1"
            value={form.baseURL}
            onChange={(e) => setForm((f) => ({ ...f, baseURL: e.target.value }))}
          />
          <p className="text-xs text-muted-foreground">
            OpenAI 兼容端点，路径自动追加 /chat/completions。
          </p>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="ag-model">模型</Label>
          <Input
            id="ag-model"
            placeholder="deepseek-chat"
            value={form.model}
            onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="ag-key">API Key</Label>
          <Input
            id="ag-key"
            type="password"
            autoComplete="off"
            placeholder="sk-..."
            value={form.apiKey}
            onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={form.includeHomeContext}
            onChange={(e) => setForm((f) => ({ ...f, includeHomeContext: e.target.checked }))}
          />
          <span>把本机的关注、书签、资源作为上下文发送</span>
        </label>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          取消
        </Button>
        <Button onClick={save}>保存</Button>
      </DialogFooter>
    </>
  )
}
