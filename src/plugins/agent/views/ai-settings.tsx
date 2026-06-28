"use client"

// 全局 AI 设置 —— 默认模型 / 上下文 / 工具审批。密钥只存本机 (见 ../lib/agent-settings)。
// 复用 AI 重设计共享套件 (ui-kit): AiPage 壳 + Panel 区段 + SettingRow + Toggle/Chip。

import * as React from "react"
import { SlidersHorizontal } from "lucide-react"

import { Input } from "@/ui/input"
import { Label } from "@/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select"

import { AiPage, Panel, SettingRow, Toggle, Chip } from "./ui-kit"
import {
  getAgentSettings,
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
              <Toggle
                checked={settings.includeHomeContext}
                onChange={(v) => update({ includeHomeContext: v })}
                label="带上「我的」数据"
              />
            </SettingRow>
          </div>
        </Panel>

        {/* 3) 工具审批 */}
        <Panel title="工具审批">
          <div className="divide-y">
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
                  <SelectItem value="auto">自动允许已授权工具</SelectItem>
                </SelectContent>
              </Select>
            </SettingRow>
          </div>
        </Panel>
      </div>
    </AiPage>
  )
}
