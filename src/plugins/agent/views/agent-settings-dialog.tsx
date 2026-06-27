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
import { AcpSettings, getAcpSettings, setAcpSettings } from "../lib/acp-settings"
import { disableAcpServer, enableAcpServer, runExposeSelfTest } from "../lib/acp-expose"
import { detectAgents, type DetectedAgent } from "../lib/acp-detect"
import { isTauri } from "@/lib/tauri"

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
  const [acp, setAcp] = React.useState<AcpSettings>(getAcpSettings)
  const [detected, setDetected] = React.useState<DetectedAgent[]>([])
  const [detecting, setDetecting] = React.useState(true) // 挂载即自动检测
  const [selftesting, setSelftesting] = React.useState(false)

  // 暴露方向一键自测: 起监听 + 内置客户端连回跑一轮, 结果经 toast 反馈。
  async function exposeSelfTest() {
    setSelftesting(true)
    try {
      setAcpSettings(acp) // 持久化当前端口/开关, 与自测一致
      const r = await runExposeSelfTest(acp.listenPort || undefined)
      if (r.ok) {
        toast.success(
          `暴露自测通过（:${r.port}）：收到 ${r.updates ?? 0} 条更新，stopReason=${r.stopReason}`,
          { description: r.text ? `回执：${r.text.slice(0, 80)}` : undefined },
        )
      } else {
        toast.error("暴露自测失败：" + (r.error ?? "未知"))
      }
    } finally {
      setSelftesting(false)
    }
  }

  // 自动检测系统上可用的外部 ACP 智能体 (仅桌面有效); 点选即填命令。
  // 仅在异步 resolve 里 setState (不在 effect 体内同步 setState)。
  React.useEffect(() => {
    let alive = true
    detectAgents()
      .then((a) => {
        if (alive) setDetected(a)
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setDetecting(false)
      })
    return () => {
      alive = false
    }
  }, [])

  // "重新检测" (事件处理里 setState 是允许的)。
  function runDetect() {
    setDetecting(true)
    detectAgents()
      .then(setDetected)
      .catch(() => {})
      .finally(() => setDetecting(false))
  }

  const presetValue = PROVIDER_PRESETS.find((p) => p.baseURL === form.baseURL)?.label ?? CUSTOM

  function applyPreset(label: string) {
    if (label === CUSTOM) return
    const p = PROVIDER_PRESETS.find((x) => x.label === label)
    if (p) setForm((f) => ({ ...f, baseURL: p.baseURL, model: p.model || f.model }))
  }

  async function save() {
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

    // ACP 暴露开关: 持久化并即时启停监听 (仅桌面 App; web/dev 仅存设置不起监听)。
    setAcpSettings(acp)
    if (isTauri()) {
      try {
        if (acp.allowEditorConnect) {
          const port = await enableAcpServer(acp.listenPort || undefined)
          toast.success(`已开启 ACP 监听 127.0.0.1:${port}`)
        } else {
          await disableAcpServer()
        }
      } catch (e) {
        toast.error("ACP 监听启动失败：" + (e instanceof Error ? e.message : String(e)))
      }
    }

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

        <div className="grid gap-1.5 border-t pt-3">
          <Label>外部协议接入（ACP）</Label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={acp.allowEditorConnect}
              onChange={(e) => setAcp((a) => ({ ...a, allowEditorConnect: e.target.checked }))}
            />
            <span>允许外部编辑器经 ACP 连入本机智能体（仅桌面 App）</span>
          </label>
          {acp.allowEditorConnect && (
            <div className="grid gap-1.5">
              <Label htmlFor="acp-port">监听端口（0 = 自动分配）</Label>
              <Input
                id="acp-port"
                inputMode="numeric"
                placeholder="0"
                value={String(acp.listenPort)}
                onChange={(e) =>
                  setAcp((a) => ({
                    ...a,
                    listenPort: Number(e.target.value.replace(/\D/g, "")) || 0,
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">
                仅监听 127.0.0.1（环回）。编辑器侧需支持 ACP socket 传输，或经 stdio↔socket
                桥接连入。
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={selftesting}
                  onClick={() => void exposeSelfTest()}
                >
                  {selftesting ? "自测中…" : "暴露自测"}
                </Button>
                <span className="text-xs text-muted-foreground">
                  起监听并用内置客户端连回自测一轮（仅桌面）
                </span>
              </div>
            </div>
          )}

          <div className="grid gap-1.5 border-t pt-2">
            <Label>外部智能体（客户端方向）</Label>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">检测：</span>
              {detecting && <span className="text-xs text-muted-foreground">检测中…</span>}
              {!detecting && detected.length === 0 && (
                <span className="text-xs text-muted-foreground">
                  未检测到（可手动填写；仅桌面 App 可探测）
                </span>
              )}
              {detected.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  title={d.note}
                  onClick={() => setAcp((a) => ({ ...a, externalAgent: d.config }))}
                  className="rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-accent"
                >
                  {d.label}
                </button>
              ))}
              <button
                type="button"
                onClick={runDetect}
                className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                重新检测
              </button>
            </div>
            <Input
              placeholder="程序，如 npx 或 claude-code-acp"
              value={acp.externalAgent.program}
              onChange={(e) =>
                setAcp((a) => ({
                  ...a,
                  externalAgent: { ...a.externalAgent, program: e.target.value },
                }))
              }
            />
            <Input
              placeholder="参数（空格分隔），如 --acp"
              value={acp.externalAgent.args}
              onChange={(e) =>
                setAcp((a) => ({
                  ...a,
                  externalAgent: { ...a.externalAgent, args: e.target.value },
                }))
              }
            />
            <Input
              placeholder="工作目录（绝对路径，可空）"
              value={acp.externalAgent.cwd}
              onChange={(e) =>
                setAcp((a) => ({
                  ...a,
                  externalAgent: { ...a.externalAgent, cwd: e.target.value },
                }))
              }
            />
            <p className="text-xs text-muted-foreground">
              在「AI 工作区 → 外部智能体」里连接并对话。命令由你配置、绝不由模型决定；仅桌面 App。
            </p>
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          取消
        </Button>
        <Button onClick={() => void save()}>保存</Button>
      </DialogFooter>
    </>
  )
}
