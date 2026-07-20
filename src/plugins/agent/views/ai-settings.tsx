"use client"

// 全局 AI 设置是 settings.json 的 Display。可同步公开字段只经 FileSystem 读写；API Key
// 使用 provider specialized action 写入安全存储。ACP 命令属于设备运行配置，也只经 specialized action 往返。

import * as React from "react"
import { Bot, Plug, ScrollText, SlidersHorizontal, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { fileRefKey, type FileRef } from "@protocol/file-system"

import { AGENT_SETTINGS_FILE_REF } from "@/filesystem/builtin-app-roots"
import { getUiActions } from "@/lib/ui-actions"
import { isTauri } from "@/lib/tauri"
import { useFileDocument } from "@/shared/use-file-document"
import { Button } from "@/ui/button"
import { Chip } from "@/ui/chip"
import { Input } from "@/ui/input"
import { Label } from "@/ui/label"
import { Panel, SettingRow } from "@/ui/panel"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select"
import { Switch } from "@/ui/switch"

import {
  AGENT_SETTINGS_ACP_DETECT_ACTION,
  AGENT_SETTINGS_ACP_PROBE_ACTION,
  AGENT_SETTINGS_ACP_READ_ACTION,
  AGENT_SETTINGS_ACP_WRITE_ACTION,
  AGENT_SETTINGS_CLEAR_API_KEY_ACTION,
  AGENT_SETTINGS_CREDENTIAL_STATUS_ACTION,
  AGENT_SETTINGS_SET_API_KEY_ACTION,
  DEFAULT_AGENT_ACP_SETTINGS,
  MAX_AGENT_SETTINGS_API_KEY_LENGTH,
  MAX_AGENT_SETTINGS_BASE_URL_LENGTH,
  MAX_AGENT_SETTINGS_MODEL_LENGTH,
  PROVIDER_PRESETS,
  decodeAgentAcpProbeResult,
  decodeAgentAcpSettings,
  decodeAgentDetectedAcpAgents,
  decodeAgentSettingsCredentialStatus,
  decodeAgentSettingsDocument,
  isAgentSettingsDocumentConfigured,
  type AgentApprovalPolicy,
  type AgentAcpSettings,
  type AgentDetectedAcpAgent,
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
  const [acpSettings, setAcpSettingsDraft] = React.useState<AgentAcpSettings | null>(null)
  const shownAcpSettings = acpSettings ?? DEFAULT_AGENT_ACP_SETTINGS
  const settingsBaseURL = settings?.baseURL
  const settingsModel = settings?.model
  const [apiKeyDraft, setApiKeyDraft] = React.useState("")
  const [baseURLDraft, setBaseURLDraft] = React.useState("")
  const [modelDraft, setModelDraft] = React.useState("")
  const [credentialConfigured, setCredentialConfigured] = React.useState<boolean | null>(null)
  const [detectedAgents, setDetectedAgents] = React.useState<AgentDetectedAcpAgent[]>([])
  const [detectingAgents, setDetectingAgents] = React.useState(false)
  const [probingExternal, setProbingExternal] = React.useState(false)
  const credentialRevision = React.useRef<string | null>(null)
  const acpRevision = React.useRef<string | null>(null)
  const acpMutationGeneration = React.useRef(0)
  const acpDraftDirty = React.useRef(false)
  const refKey = fileRefKey(fileRef)

  React.useEffect(() => {
    credentialRevision.current = null
    setApiKeyDraft("")
    setCredentialConfigured(null)
    setAcpSettingsDraft(null)
    acpRevision.current = null
    acpMutationGeneration.current += 1
    acpDraftDirty.current = false
  }, [refKey])

  React.useEffect(() => {
    if (settingsBaseURL === undefined || settingsModel === undefined) return
    setBaseURLDraft(settingsBaseURL)
    setModelDraft(settingsModel)
  }, [refKey, settingsBaseURL, settingsModel])

  React.useEffect(() => {
    if (!settings || acpDraftDirty.current) return
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

  React.useEffect(() => {
    if (!settings) return
    const revision = `${refKey}:${document.version ?? "unversioned"}`
    if (acpRevision.current === revision) return
    acpRevision.current = revision
    const generation = acpMutationGeneration.current
    void invokeDocumentAction(AGENT_SETTINGS_ACP_READ_ACTION)
      .then(decodeAgentAcpSettings)
      .then((value) => {
        if (generation === acpMutationGeneration.current) setAcpSettingsDraft(value)
      })
      .catch(() => {
        if (generation === acpMutationGeneration.current) {
          acpRevision.current = null
          setAcpSettingsDraft(null)
        }
      })
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

  const persistAcpSettings = (next: AgentAcpSettings) => {
    const generation = ++acpMutationGeneration.current
    acpDraftDirty.current = true
    setAcpSettingsDraft(next)
    void invokeDocumentAction(AGENT_SETTINGS_ACP_WRITE_ACTION, next)
      .then(decodeAgentAcpSettings)
      .then((value) => {
        if (generation === acpMutationGeneration.current) {
          acpDraftDirty.current = false
          setAcpSettingsDraft(value)
        }
      })
      .catch(() => {
        if (generation !== acpMutationGeneration.current) return
        acpDraftDirty.current = false
        acpRevision.current = null
        setAcpSettingsDraft(null)
        void refreshDocument()
          .then(() => invokeDocumentAction(AGENT_SETTINGS_ACP_READ_ACTION))
          .then(decodeAgentAcpSettings)
          .then((value) => {
            if (generation === acpMutationGeneration.current) setAcpSettingsDraft(value)
          })
          .catch(() => {})
      })
  }

  const updateAcp = (patch: Partial<AgentAcpSettings>, persist: boolean) => {
    if (!acpSettings) return
    const next = decodeAgentAcpSettings({ ...acpSettings, ...patch })
    if (persist) {
      persistAcpSettings(next)
      return
    }
    acpMutationGeneration.current += 1
    acpDraftDirty.current = true
    setAcpSettingsDraft(next)
  }

  const runAgentDetection = () => {
    setDetectingAgents(true)
    void invokeDocumentAction(AGENT_SETTINGS_ACP_DETECT_ACTION)
      .then(decodeAgentDetectedAcpAgents)
      .then(setDetectedAgents)
      .catch(() => setDetectedAgents([]))
      .finally(() => setDetectingAgents(false))
  }

  const probeExternal = () => {
    if (!shownAcpSettings.externalAgent.program.trim()) return
    setProbingExternal(true)
    void invokeDocumentAction(AGENT_SETTINGS_ACP_PROBE_ACTION, {
      externalAgent: shownAcpSettings.externalAgent,
    })
      .then(decodeAgentAcpProbeResult)
      .then((result) =>
        toast.success(`外部 Agent 已连通（${result.latencyMs} ms）`, {
          description: `ACP protocol ${result.protocolVersion}`,
        }),
      )
      .catch((error) =>
        toast.error("外部 Agent 连接失败", {
          description: error instanceof Error ? error.message : String(error),
        }),
      )
      .finally(() => setProbingExternal(false))
  }

  const modelConfigured = settings
    ? isAgentSettingsDocumentConfigured(settings, credentialConfigured === true)
    : false
  const externalRuntimeAvailable = isTauri()
  const externalConfigured =
    externalRuntimeAvailable && Boolean(shownAcpSettings.externalAgent.program.trim())
  const configured =
    shownAcpSettings.executionBackend === "external-acp" ? externalConfigured : modelConfigured

  return (
    <AiPage
      title="全局 AI 设置"
      icon={SlidersHorizontal}
      width="2xl"
      action={
        <Chip tone={configured ? "ok" : "warn"}>
          {document.loading
            ? "读取中"
            : shownAcpSettings.executionBackend === "external-acp"
              ? !externalRuntimeAvailable
                ? "仅桌面 App 可用"
                : configured
                  ? "外部 Agent 已就绪"
                  : "未配置外部 Agent"
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

        <Panel title="执行后端">
          <div className="space-y-5">
            <SettingRow label="当前后端">
              <Select
                value={shownAcpSettings.executionBackend}
                disabled={!acpSettings}
                onValueChange={(value) =>
                  updateAcp(
                    {
                      executionBackend: value === "external-acp" ? "external-acp" : "model",
                    },
                    true,
                  )
                }
              >
                <SelectTrigger className="h-9 w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="model">内置 OpenAI 兼容模型</SelectItem>
                  <SelectItem value="external-acp">外部 ACP Agent（桌面）</SelectItem>
                </SelectContent>
              </Select>
            </SettingRow>

            <div className="space-y-3 border-t pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">外部 ACP Agent</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    用户配置的本机进程；不会获得 ideall MCP。其操作仍可能使用当前系统账号权限。
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!isTauri() || detectingAgents}
                    onClick={runAgentDetection}
                  >
                    {detectingAgents ? "检测中…" : "检测本机 Agent"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={
                      !isTauri() ||
                      !acpSettings ||
                      probingExternal ||
                      !shownAcpSettings.externalAgent.program.trim()
                    }
                    onClick={probeExternal}
                  >
                    {probingExternal ? "诊断中…" : "连接诊断"}
                  </Button>
                </div>
              </div>

              {detectedAgents.length ? (
                <div className="flex flex-wrap gap-2">
                  {detectedAgents.map((agent) => (
                    <Button
                      key={agent.id}
                      type="button"
                      size="sm"
                      variant="outline"
                      title={agent.note}
                      onClick={() => updateAcp({ externalAgent: agent.config }, true)}
                    >
                      <Bot className="h-3.5 w-3.5" />
                      {agent.label}
                    </Button>
                  ))}
                </div>
              ) : null}

              <div className="grid gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="external-acp-program">程序</Label>
                  <Input
                    id="external-acp-program"
                    value={shownAcpSettings.externalAgent.program}
                    disabled={!acpSettings}
                    maxLength={512}
                    placeholder="如 claude-code-acp、gemini 或 node"
                    onChange={(event) =>
                      updateAcp(
                        {
                          externalAgent: {
                            ...shownAcpSettings.externalAgent,
                            program: event.target.value,
                          },
                        },
                        false,
                      )
                    }
                    onBlur={() => {
                      if (acpDraftDirty.current) persistAcpSettings(shownAcpSettings)
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="external-acp-args">参数</Label>
                  <Input
                    id="external-acp-args"
                    value={shownAcpSettings.externalAgent.args}
                    disabled={!acpSettings}
                    maxLength={8192}
                    placeholder='支持引号，如 --mode "safe mode"'
                    onChange={(event) =>
                      updateAcp(
                        {
                          externalAgent: {
                            ...shownAcpSettings.externalAgent,
                            args: event.target.value,
                          },
                        },
                        false,
                      )
                    }
                    onBlur={() => {
                      if (acpDraftDirty.current) persistAcpSettings(shownAcpSettings)
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="external-acp-cwd">工作目录</Label>
                  <Input
                    id="external-acp-cwd"
                    value={shownAcpSettings.externalAgent.cwd}
                    disabled={!acpSettings}
                    maxLength={4096}
                    placeholder="绝对路径；留空使用当前用户主目录"
                    onChange={(event) =>
                      updateAcp(
                        {
                          externalAgent: {
                            ...shownAcpSettings.externalAgent,
                            cwd: event.target.value,
                          },
                        },
                        false,
                      )
                    }
                    onBlur={() => {
                      if (acpDraftDirty.current) persistAcpSettings(shownAcpSettings)
                    }}
                  />
                </div>
              </div>

              <p className="text-xs leading-5 text-muted-foreground">
                普通对话自动拒绝 ACP
                权限请求；开启“智能体”后逐次确认并写入本机审计。停止对话会取消请求并终止子进程。仅桌面
                App 可运行。命令配置保存在本机公开设置中，请勿把 token 或密码写入参数。
              </p>
            </div>
          </div>
        </Panel>

        <Panel title="内置模型（可作为备用）">
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
