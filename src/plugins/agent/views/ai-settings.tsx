"use client"

// 全局 AI 设置 —— 默认模型 / 上下文 / 工具审批。密钥只存本机 (见 ../lib/agent-settings)。
// 复用 AI 重设计共享套件: AiPage 壳 + 公共 Panel/SettingRow/Switch/Chip 原语。

import * as React from "react"
import { Plug, ScrollText, SlidersHorizontal, Sparkles } from "lucide-react"

import { Button } from "@/ui/button"
import { Chip } from "@/ui/chip"
import { Input } from "@/ui/input"
import { Label } from "@/ui/label"
import { Panel, SettingRow } from "@/ui/panel"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select"
import { Switch } from "@/ui/switch"
import { getUiActions } from "@/lib/ui-actions"

import { AiPage } from "./ui-kit"
import {
  getAgentSettings,
  hydrateAgentSettingsSecure,
  setAgentSettings,
  subscribeAgentSettings,
  PROVIDER_PRESETS,
  isConfigured,
  type AgentSettings,
} from "../lib/agent-settings"

const CUSTOM_LABEL = "自定义"

export default function AiSettings() {
  const settings = React.useSyncExternalStore(
    subscribeAgentSettings,
    getAgentSettings,
    getAgentSettings,
  )
  const update = (patch: Partial<AgentSettings>) => setAgentSettings({ ...settings, ...patch })

  React.useEffect(() => {
    void hydrateAgentSettingsSecure()
  }, [])

  const presetLabel =
    PROVIDER_PRESETS.find((p) => p.baseURL === settings.baseURL)?.label ?? CUSTOM_LABEL

  const onPresetChange = (label: string) => {
    const preset = PROVIDER_PRESETS.find((p) => p.label === label)
    if (preset) update({ baseURL: preset.baseURL, model: preset.model || settings.model })
  }

  return (
    <AiPage
      title="全局 AI 设置"
      icon={SlidersHorizontal}
      width="2xl"
      action={
        <Chip tone={isConfigured(settings) ? "ok" : "warn"}>
          {isConfigured(settings) ? "已就绪" : "未配置"}
        </Chip>
      }
    >
      <div className="space-y-8">
        <Panel title="管理">
          <div className="grid gap-2 sm:grid-cols-3">
            <Button
              type="button"
              variant="outline"
              className="justify-start gap-2"
              onClick={() => getUiActions()?.openAiSection?.("ai-mcp")}
            >
              <Plug className="h-4 w-4" />
              MCP
            </Button>
            <Button
              type="button"
              variant="outline"
              className="justify-start gap-2"
              onClick={() => getUiActions()?.openAiSection?.("ai-skills")}
            >
              <Sparkles className="h-4 w-4" />
              Skills
            </Button>
            <Button
              type="button"
              variant="outline"
              className="justify-start gap-2"
              onClick={() => getUiActions()?.openAiSection?.("ai-rules")}
            >
              <ScrollText className="h-4 w-4" />
              规则
            </Button>
          </div>
        </Panel>

        {/* 1) 模型 */}
        <Panel title="模型">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ai-preset">预设</Label>
              <Select value={presetLabel} onValueChange={onPresetChange}>
                <SelectTrigger id="ai-preset" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDER_PRESETS.map((p) => (
                    <SelectItem key={p.label} value={p.label}>
                      {p.label}
                    </SelectItem>
                  ))}
                  <SelectItem value={CUSTOM_LABEL}>{CUSTOM_LABEL}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ai-baseurl">API Base</Label>
              <Input
                id="ai-baseurl"
                value={settings.baseURL}
                placeholder="https://api.deepseek.com/v1"
                onChange={(e) => update({ baseURL: e.target.value })}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ai-model">模型</Label>
              <Input
                id="ai-model"
                value={settings.model}
                placeholder="deepseek-chat"
                onChange={(e) => update({ model: e.target.value })}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ai-apikey">API Key</Label>
              <Input
                id="ai-apikey"
                type="password"
                autoComplete="off"
                value={settings.apiKey}
                placeholder="sk-..."
                onChange={(e) => update({ apiKey: e.target.value })}
              />
            </div>
          </div>
        </Panel>

        {/* 2) 上下文 */}
        <Panel title="上下文">
          <div className="divide-y">
            <SettingRow label="带上「我的」数据">
              <Switch
                checked={settings.includeHomeContext}
                onChange={(v) => update({ includeHomeContext: v })}
                label="带上「我的」数据"
              />
            </SettingRow>
          </div>
        </Panel>

        {/* 3) 智能体能力 */}
        <Panel title="智能体能力">
          <div className="divide-y">
            <SettingRow label="默认开启智能体模式">
              <Switch
                checked={settings.defaultAgentMode}
                onChange={(v) => update({ defaultAgentMode: v })}
                label="默认开启智能体模式"
              />
            </SettingRow>
            <SettingRow label="工具调用审批">
              <Select
                value={settings.approvalPolicy}
                onValueChange={(v) => update({ approvalPolicy: v as "confirm" | "auto" })}
              >
                <SelectTrigger className="h-9 w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="confirm">逐次确认（安全）</SelectItem>
                  <SelectItem value="auto">自动允许低风险工具</SelectItem>
                </SelectContent>
              </Select>
            </SettingRow>
          </div>
        </Panel>
      </div>
    </AiPage>
  )
}
