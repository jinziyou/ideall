"use client"

// 全局 AI 设置是 settings.json 的 Display。公开字段只经 FileSystem 读写；API Key
// 使用 provider specialized action 写入安全存储，绝不进入公开文档或受控输入初值。

import * as React from "react"
import { Plug, ScrollText, SlidersHorizontal, Sparkles } from "lucide-react"
import { fileRefKey, type FileRef } from "@protocol/file-system"

import { AGENT_SETTINGS_FILE_REF } from "@/filesystem/builtin-app-roots"
import { getUiActions } from "@/lib/ui-actions"
import { useFileDocument } from "@/shared/use-file-document"
import { Button } from "@/ui/button"
import { Chip } from "@/ui/chip"
import { Input } from "@/ui/input"
import { Label } from "@/ui/label"
import { Panel, SettingRow } from "@/ui/panel"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select"
import { Switch } from "@/ui/switch"

import {
  AGENT_SETTINGS_CLEAR_API_KEY_ACTION,
  AGENT_SETTINGS_CREDENTIAL_STATUS_ACTION,
  AGENT_SETTINGS_SET_API_KEY_ACTION,
  MAX_AGENT_SETTINGS_API_KEY_LENGTH,
  MAX_AGENT_SETTINGS_BASE_URL_LENGTH,
  MAX_AGENT_SETTINGS_MODEL_LENGTH,
  PROVIDER_PRESETS,
  decodeAgentSettingsCredentialStatus,
  decodeAgentSettingsDocument,
  isAgentSettingsDocumentConfigured,
  type AgentApprovalPolicy,
  type AgentSettingsDocument,
} from "../agent-settings-file-contract"
import { AiPage } from "./ui-kit"

const CUSTOM_LABEL = "自定义"

export type AiSettingsProps = Readonly<{ fileRef?: FileRef }>

export default function AiSettings({ fileRef = AGENT_SETTINGS_FILE_REF }: AiSettingsProps) {
  const document = useFileDocument(fileRef, decodeAgentSettingsDocument)
  const invokeDocumentAction = document.invoke
  const refreshDocument = document.refresh
  const updateDocument = document.update
  const settings = document.data
  const settingsBaseURL = settings?.baseURL
  const settingsModel = settings?.model
  const [apiKeyDraft, setApiKeyDraft] = React.useState("")
  const [baseURLDraft, setBaseURLDraft] = React.useState("")
  const [modelDraft, setModelDraft] = React.useState("")
  const [credentialConfigured, setCredentialConfigured] = React.useState<boolean | null>(null)
  const credentialRevision = React.useRef<string | null>(null)
  const refKey = fileRefKey(fileRef)

  React.useEffect(() => {
    credentialRevision.current = null
    setApiKeyDraft("")
    setCredentialConfigured(null)
  }, [refKey])

  React.useEffect(() => {
    if (settingsBaseURL === undefined || settingsModel === undefined) return
    setBaseURLDraft(settingsBaseURL)
    setModelDraft(settingsModel)
  }, [refKey, settingsBaseURL, settingsModel])

  React.useEffect(() => {
    if (!settings) return
    const revision = `${refKey}:${document.version ?? "unversioned"}`
    if (credentialRevision.current === revision) return
    credentialRevision.current = revision
    let cancelled = false
    void invokeDocumentAction(AGENT_SETTINGS_CREDENTIAL_STATUS_ACTION)
      .then(decodeAgentSettingsCredentialStatus)
      .then((status) => {
        if (!cancelled) setCredentialConfigured(status.configured)
      })
      .catch(() => {
        if (!cancelled) {
          if (credentialRevision.current === revision) credentialRevision.current = null
          setCredentialConfigured(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [document.version, invokeDocumentAction, refKey, settings])

  const update = React.useCallback(
    (patch: Partial<AgentSettingsDocument>) => {
      void updateDocument((current) => ({ ...current, ...patch })).catch(() => {})
    },
    [updateDocument],
  )

  const presetLabel =
    PROVIDER_PRESETS.find((preset) => preset.baseURL === settings?.baseURL)?.label ?? CUSTOM_LABEL

  const onPresetChange = (label: string) => {
    if (!settings) return
    const preset = PROVIDER_PRESETS.find((candidate) => candidate.label === label)
    if (preset) {
      const model = preset.model || settings.model
      setBaseURLDraft(preset.baseURL)
      setModelDraft(model)
      update({ baseURL: preset.baseURL, model })
    }
  }

  const saveApiKey = () => {
    const apiKey = apiKeyDraft.trim()
    if (!apiKey) return
    void invokeDocumentAction(AGENT_SETTINGS_SET_API_KEY_ACTION, { apiKey })
      .then(decodeAgentSettingsCredentialStatus)
      .then((status) => {
        setCredentialConfigured(status.configured)
        setApiKeyDraft("")
      })
      .catch(() => {})
  }

  const clearApiKey = () => {
    void invokeDocumentAction(AGENT_SETTINGS_CLEAR_API_KEY_ACTION)
      .then(decodeAgentSettingsCredentialStatus)
      .then((status) => {
        setCredentialConfigured(status.configured)
        setApiKeyDraft("")
      })
      .catch(() => {})
  }

  const retryCredentialStatus = () => {
    credentialRevision.current = null
    void refreshDocument().catch(() => {})
  }

  const configured = settings
    ? isAgentSettingsDocumentConfigured(settings, credentialConfigured === true)
    : false

  return (
    <AiPage
      title="全局 AI 设置"
      icon={SlidersHorizontal}
      width="2xl"
      action={
        <Chip tone={configured ? "ok" : "warn"}>
          {document.loading
            ? "读取中"
            : credentialConfigured === null
              ? "状态未知"
              : configured
                ? "已就绪"
                : "未配置"}
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

        <Panel title="模型">
          {!settings ? (
            <p className="text-sm text-muted-foreground">正在读取 settings.json…</p>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="ai-preset">预设</Label>
                <Select
                  value={presetLabel}
                  onValueChange={onPresetChange}
                  disabled={document.saving}
                >
                  <SelectTrigger id="ai-preset" className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDER_PRESETS.map((preset) => (
                      <SelectItem key={preset.label} value={preset.label}>
                        {preset.label}
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
                  value={baseURLDraft}
                  placeholder="https://api.deepseek.com/v1"
                  disabled={document.saving}
                  maxLength={MAX_AGENT_SETTINGS_BASE_URL_LENGTH}
                  onChange={(event) => setBaseURLDraft(event.target.value)}
                  onBlur={() => {
                    const baseURL = baseURLDraft.trim()
                    setBaseURLDraft(baseURL)
                    if (baseURL !== settings.baseURL) update({ baseURL })
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur()
                  }}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ai-model">模型</Label>
                <Input
                  id="ai-model"
                  value={modelDraft}
                  placeholder="deepseek-chat"
                  disabled={document.saving}
                  maxLength={MAX_AGENT_SETTINGS_MODEL_LENGTH}
                  onChange={(event) => setModelDraft(event.target.value)}
                  onBlur={() => {
                    const model = modelDraft.trim()
                    setModelDraft(model)
                    if (model !== settings.model) update({ model })
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur()
                  }}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ai-apikey">API Key</Label>
                <Input
                  id="ai-apikey"
                  type="password"
                  autoComplete="off"
                  value={apiKeyDraft}
                  maxLength={MAX_AGENT_SETTINGS_API_KEY_LENGTH}
                  placeholder={credentialConfigured ? "已配置；输入新 Key 可替换" : "sk-..."}
                  disabled={document.acting}
                  onChange={(event) => setApiKeyDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") saveApiKey()
                  }}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    onClick={saveApiKey}
                    disabled={document.acting || !apiKeyDraft.trim()}
                  >
                    保存 API Key
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={clearApiKey}
                    disabled={document.acting || credentialConfigured !== true}
                  >
                    清除 API Key
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {credentialConfigured === null
                      ? "凭据状态不可用"
                      : credentialConfigured
                        ? "安全存储中已配置"
                        : "尚未配置凭据"}
                  </span>
                  {credentialConfigured === null ? (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={retryCredentialStatus}
                      disabled={document.acting}
                    >
                      重试状态
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          )}
        </Panel>

        <Panel title="上下文">
          <div className="divide-y">
            <SettingRow label="带上「我的」数据">
              <Switch
                checked={settings?.includeHomeContext ?? false}
                disabled={!settings || document.saving}
                onChange={(value) => update({ includeHomeContext: value })}
                label="带上「我的」数据"
              />
            </SettingRow>
          </div>
        </Panel>

        <Panel title="智能体能力">
          <div className="divide-y">
            <SettingRow label="默认开启智能体模式">
              <Switch
                checked={settings?.defaultAgentMode ?? false}
                disabled={!settings || document.saving}
                onChange={(value) => update({ defaultAgentMode: value })}
                label="默认开启智能体模式"
              />
            </SettingRow>
            <SettingRow label="工具调用审批">
              <Select
                value={settings?.approvalPolicy ?? "confirm"}
                disabled={!settings || document.saving}
                onValueChange={(value) => update({ approvalPolicy: value as AgentApprovalPolicy })}
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

        {document.error ? (
          <p role="status" className="text-sm text-destructive">
            设置操作失败，请重试。
          </p>
        ) : null}
      </div>
    </AiPage>
  )
}
