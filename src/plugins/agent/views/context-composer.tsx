"use client"

// 上下文组合器: 把一个 AI 工作区的「数据 + 能力 + 规则 + 提示词 + 模型」收敛为可勾选的五组, 每组都有默认。
// 通过 workspace adapter 合并锁内最新快照，改动即时进入 resolveRun (下次发送生效)。
// 安全: 能力位只能在 AGENT_CONFIGURABLE_PERMISSIONS 内选择；敏感配置读取默认关闭。

import * as React from "react"
import { getFilesPort } from "@protocol/files"
import { toast } from "sonner"
import { Checkbox } from "@/ui/checkbox"
import { Input } from "@/ui/input"
import { Label } from "@/ui/label"
import { Panel } from "@/ui/panel"
import { Textarea } from "@/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select"
import { infoEmbedManifest, communityEmbedManifest } from "@/plugins/embed/manifest"
import { CAPABILITY_OPTIONS } from "../lib/agent-capabilities"
import { BUILTIN_SKILLS } from "../lib/agent-skills"
import { getRules, getServerRules, subscribeRules } from "../lib/agent-rules"
import { PROVIDER_PRESETS } from "../lib/agent-settings"
import {
  AgentWorkspaceCredentialTargetConflictError,
  agentWorkspaceCredentialTarget,
  updateWorkspace,
  updateWorkspaceApiKey,
} from "../agent-workspace-write-adapter"
import {
  type AgentWorkspace,
  type WorkspaceCapabilities,
  type WorkspaceData,
} from "../lib/agent-workspace"
import { useWorkspaceTextDraft } from "./use-workspace-text-draft"
import {
  acknowledgeWorkspaceModelSelection,
  beginWorkspaceModelSelection,
  createWorkspaceModelSelectionCoordinator,
  createWorkspaceModelSelectionDisplayState,
  reconcileWorkspaceModelSelectionDisplay,
  rejectWorkspaceModelSelection,
  type WorkspaceModelSelectionDisplayState,
} from "./workspace-model-selection"

const APP_OPTIONS = [infoEmbedManifest, communityEmbedManifest]
const APP_IDS = APP_OPTIONS.map((a) => a.id)
const SKILL_IDS = BUILTIN_SKILLS.map((s) => s.id)

const DEFAULT_DIR = "__root__"
const GLOBAL_MODEL = "__global__"
const CUSTOM_PRESET = "__custom__"

const DATA_KINDS: { key: keyof WorkspaceData["home"]; label: string }[] = [
  { key: "notes", label: "文件" },
  { key: "subscriptions", label: "关注" },
  { key: "bookmarks", label: "书签" },
  { key: "folders", label: "收藏夹" },
  { key: "files", label: "资源文件" },
]

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Panel title={title}>
      <div className="space-y-3">{children}</div>
    </Panel>
  )
}

function Row({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        className="mt-0.5"
      />
      <span className="min-w-0">
        <span>{label}</span>
      </span>
    </label>
  )
}

/** 选中=全部时折叠回 null (= 全部, 新增项自动纳入); 否则返回显式 id 列表。 */
function toggleNullable(
  ids: string[] | null,
  allIds: string[],
  id: string,
  on: boolean,
): string[] | null {
  const base = ids ?? [...allIds]
  const next = on ? [...new Set([...base, id])] : base.filter((x) => x !== id)
  return allIds.length === next.length && allIds.every((a) => next.includes(a)) ? null : next
}

export default function ContextComposer({
  ws,
  sourceVersion,
}: {
  ws: AgentWorkspace
  sourceVersion: string
}) {
  const [folders, setFolders] = React.useState<{ id: string; name: string }[]>([])
  const durableModelSelection = modelSelectionValue(ws)
  const [modelSelectionDisplay, setModelSelectionDisplay] =
    React.useState<WorkspaceModelSelectionDisplayState>(() =>
      createWorkspaceModelSelectionDisplayState(ws.id, durableModelSelection, sourceVersion),
    )
  const modelSelectionDisplayRef = React.useRef(modelSelectionDisplay)
  const visibleModelSelection = reconcileWorkspaceModelSelectionDisplay(
    modelSelectionDisplay,
    ws.id,
    durableModelSelection,
    sourceVersion,
  )
  const updateModelSelectionDisplay = React.useCallback(
    (
      updater: (
        current: WorkspaceModelSelectionDisplayState,
      ) => WorkspaceModelSelectionDisplayState,
    ) => {
      const next = updater(modelSelectionDisplayRef.current)
      modelSelectionDisplayRef.current = next
      setModelSelectionDisplay(next)
    },
    [],
  )
  const keepFailedDraft = React.useCallback(() => {
    toast.error("保存工作区失败")
    return "keep" as const
  }, [])

  const osDirDraft = useWorkspaceTextDraft({
    workspaceId: ws.id,
    sourceValue: ws.data.osDir ?? "",
    sourceVersion,
    context: undefined,
    async commit(workspaceId, osDir) {
      const updated = await updateWorkspace(workspaceId, (current) => ({
        ...current,
        data: { ...current.data, osDir: osDir || null },
      }))
      if (!updated) throw new Error("Agent workspace no longer exists")
      return updated.data.osDir ?? ""
    },
    onError: keepFailedDraft,
  })
  const instructionsDraft = useWorkspaceTextDraft({
    workspaceId: ws.id,
    sourceValue: ws.prompt.instructions,
    sourceVersion,
    context: undefined,
    async commit(workspaceId, instructions) {
      const updated = await updateWorkspace(workspaceId, (current) => ({
        ...current,
        prompt: { ...current.prompt, instructions },
      }))
      if (!updated) throw new Error("Agent workspace no longer exists")
      return updated.prompt.instructions
    },
    onError: keepFailedDraft,
  })
  const baseUrlDraft = useWorkspaceTextDraft({
    workspaceId: ws.id,
    sourceValue: ws.model.baseURL,
    sourceVersion,
    context: undefined,
    async commit(workspaceId, baseURL) {
      const updated = await updateWorkspace(workspaceId, (current) => ({
        ...current,
        model: { ...current.model, baseURL },
      }))
      if (!updated) throw new Error("Agent workspace no longer exists")
      return updated.model.baseURL
    },
    onError: keepFailedDraft,
  })
  const modelDraft = useWorkspaceTextDraft({
    workspaceId: ws.id,
    sourceValue: ws.model.model,
    sourceVersion,
    context: undefined,
    async commit(workspaceId, model) {
      const updated = await updateWorkspace(workspaceId, (current) => ({
        ...current,
        model: { ...current.model, model },
      }))
      if (!updated) throw new Error("Agent workspace no longer exists")
      return updated.model.model
    },
    onError: keepFailedDraft,
  })
  const apiKeyTarget = ws.model.useGlobal
    ? null
    : agentWorkspaceCredentialTarget(baseUrlDraft.value)
  const apiKeyDraft = useWorkspaceTextDraft({
    workspaceId: ws.id,
    sourceValue: ws.model.apiKey,
    sourceVersion,
    context: apiKeyTarget,
    async commit(workspaceId, apiKey, expectedTarget) {
      // A visible endpoint draft must become durable before its key can be bound to that target.
      await baseUrlDraft.flush()
      const updated = await updateWorkspaceApiKey(workspaceId, expectedTarget, apiKey)
      if (!updated) throw new Error("Agent workspace no longer exists")
      return updated.model.apiKey
    },
    onError(error) {
      if (error instanceof AgentWorkspaceCredentialTargetConflictError) {
        toast.error("模型地址已变化，请重新输入 API Key")
        return "clear"
      }
      toast.error("保存工作区 API Key 失败")
      return "keep"
    },
  })
  const flushBaseUrlDraft = baseUrlDraft.flush
  const flushModelDraft = modelDraft.flush
  const flushApiKeyDraft = apiKeyDraft.flush

  const modelSelection = React.useMemo(
    () =>
      createWorkspaceModelSelectionCoordinator<string>({
        async flushDrafts() {
          // Wait for every queue to settle even if one rejects. Returning on the first rejection
          // would let a remaining old draft finish after the direct preset write.
          const results = await Promise.allSettled([
            flushBaseUrlDraft(),
            flushModelDraft(),
            flushApiKeyDraft(),
          ])
          const failed = results.find(
            (result): result is PromiseRejectedResult => result.status === "rejected",
          )
          if (failed) throw failed.reason
        },
        async apply(selection) {
          const updated = await updateWorkspace(ws.id, (current) => {
            if (selection === GLOBAL_MODEL) {
              return { ...current, model: { ...current.model, useGlobal: true } }
            }
            if (selection === CUSTOM_PRESET) {
              return { ...current, model: { ...current.model, useGlobal: false } }
            }
            const preset = PROVIDER_PRESETS.find((candidate) => candidate.label === selection)
            if (!preset) return current
            return {
              ...current,
              model: {
                ...current.model,
                useGlobal: false,
                baseURL: preset.baseURL,
                model: preset.model || current.model.model,
              },
            }
          })
          if (!updated) throw new Error("Agent workspace no longer exists")
        },
        onError(failure) {
          toast.error(
            failure.phase === "flush" ? "模型草稿保存失败，未切换模型" : "保存工作区模型失败",
          )
        },
      }),
    [flushApiKeyDraft, flushBaseUrlDraft, flushModelDraft, ws.id],
  )

  React.useEffect(() => {
    updateModelSelectionDisplay((current) =>
      reconcileWorkspaceModelSelectionDisplay(current, ws.id, durableModelSelection, sourceVersion),
    )
  }, [durableModelSelection, sourceVersion, updateModelSelectionDisplay, ws.id])

  React.useEffect(() => {
    let alive = true
    getFilesPort()
      .listFolders()
      .then((fs) => {
        if (alive) setFolders(fs.map((f) => ({ id: f.id, name: f.name })))
      })
      .catch(() => {
        /* 取目录失败时只留默认目录 */
      })
    return () => {
      alive = false
    }
  }, [])

  const commit = (updater: (current: AgentWorkspace) => AgentWorkspace) => {
    void updateWorkspace(ws.id, updater).catch(() => toast.error("保存工作区失败"))
  }
  const patchData = (updater: (current: WorkspaceData) => WorkspaceData) => {
    commit((current) => ({ ...current, data: updater(current.data) }))
  }
  const patchCaps = (updater: (current: WorkspaceCapabilities) => WorkspaceCapabilities) => {
    commit((current) => ({ ...current, capabilities: updater(current.capabilities) }))
  }

  const skillIds = ws.capabilities.skillIds
  const appIds = ws.capabilities.appIds

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl space-y-6 px-6 py-6">
          {/* —— 数据 —— */}
          <Section title="数据">
            <Row
              checked={ws.data.includeHome}
              onChange={(v) => patchData((current) => ({ ...current, includeHome: v }))}
              label="带上「我的」概览"
            />
            {ws.data.includeHome && (
              <div className="ml-6 grid grid-cols-2 gap-x-3 gap-y-1.5">
                {DATA_KINDS.map((k) => (
                  <Row
                    key={k.key}
                    checked={ws.data.home[k.key]}
                    onChange={(v) =>
                      patchData((current) => ({
                        ...current,
                        home: { ...current.home, [k.key]: v },
                      }))
                    }
                    label={k.label}
                  />
                ))}
              </div>
            )}
            <div className="space-y-1.5 pt-1">
              <Label className="text-xs">本地目录</Label>
              <Select
                value={ws.data.dirNodeId ?? DEFAULT_DIR}
                onValueChange={(v) =>
                  patchData((current) => ({
                    ...current,
                    dirNodeId: v === DEFAULT_DIR ? null : v,
                  }))
                }
              >
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DEFAULT_DIR}>默认目录（「我的」根）</SelectItem>
                  {folders.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                className="h-8"
                placeholder="本地文件夹路径（桌面端，未启用文件系统访问时仅记录）"
                value={osDirDraft.value}
                onChange={(e) => osDirDraft.setValue(e.target.value)}
                onBlur={() => void osDirDraft.flush().catch(() => {})}
              />
            </div>
          </Section>

          {/* —— 能力 —— */}
          <Section title="能力">
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                工具（智能体模式下可调用）
              </p>
              {CAPABILITY_OPTIONS.map((c) => (
                <Row
                  key={c.perm}
                  checked={ws.capabilities.permissions.includes(c.perm)}
                  onChange={(v) =>
                    patchCaps((current) => ({
                      ...current,
                      permissions: v
                        ? [...new Set([...current.permissions, c.perm])]
                        : current.permissions.filter((p) => p !== c.perm),
                    }))
                  }
                  label={c.label}
                />
              ))}
            </div>
            <div className="space-y-1.5 pt-1">
              <p className="text-xs font-medium text-muted-foreground">技能</p>
              {BUILTIN_SKILLS.map((s) => (
                <Row
                  key={s.id}
                  checked={skillIds ? skillIds.includes(s.id) : true}
                  onChange={(v) =>
                    patchCaps((current) => ({
                      ...current,
                      skillIds: toggleNullable(current.skillIds, SKILL_IDS, s.id, v),
                    }))
                  }
                  label={s.label}
                />
              ))}
            </div>
            <div className="space-y-1.5 pt-1">
              <p className="text-xs font-medium text-muted-foreground">应用（嵌入）</p>
              {APP_OPTIONS.map((a) => (
                <Row
                  key={a.id}
                  checked={appIds ? appIds.includes(a.id) : true}
                  onChange={(v) =>
                    patchCaps((current) => ({
                      ...current,
                      appIds: toggleNullable(current.appIds, APP_IDS, a.id, v),
                    }))
                  }
                  label={a.name}
                />
              ))}
            </div>
          </Section>

          {/* —— 规则 —— */}
          <Section title="规则">
            <WorkspaceRulesPicker ws={ws} />
          </Section>

          {/* —— 提示词 —— */}
          <Section title="提示词 / 指令">
            <Textarea
              rows={3}
              placeholder="例如：你是我的科研助理，围绕本工作目录的资料作答…"
              value={instructionsDraft.value}
              onChange={(e) => instructionsDraft.setValue(e.target.value)}
              onBlur={() => void instructionsDraft.flush().catch(() => {})}
            />
          </Section>

          {/* —— 模型 —— */}
          <Section title="模型">
            <Select
              value={visibleModelSelection.value}
              onValueChange={(v) => {
                const intent = beginWorkspaceModelSelection(
                  modelSelectionDisplayRef.current,
                  ws.id,
                  durableModelSelection,
                  sourceVersion,
                  v,
                )
                modelSelectionDisplayRef.current = intent.state
                setModelSelectionDisplay(intent.state)
                void modelSelection
                  .select(v)
                  .then((applied) => {
                    if (!applied) return
                    updateModelSelectionDisplay((current) =>
                      acknowledgeWorkspaceModelSelection(current, intent.token),
                    )
                  })
                  .catch(() => {
                    updateModelSelectionDisplay((current) =>
                      rejectWorkspaceModelSelection(current, intent.token),
                    )
                  })
              }}
            >
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={GLOBAL_MODEL}>沿用全局设置</SelectItem>
                {PROVIDER_PRESETS.map((p) => (
                  <SelectItem key={p.label} value={p.label}>
                    {p.label}
                  </SelectItem>
                ))}
                <SelectItem value={CUSTOM_PRESET}>自定义</SelectItem>
              </SelectContent>
            </Select>
            {!ws.model.useGlobal && (
              <div className="space-y-2 pt-1">
                <Input
                  className="h-8"
                  placeholder="API Base URL（如 https://api.deepseek.com/v1）"
                  value={baseUrlDraft.value}
                  onChange={(e) => baseUrlDraft.setValue(e.target.value)}
                  onBlur={() => void baseUrlDraft.flush().catch(() => {})}
                />
                <Input
                  className="h-8"
                  placeholder="模型名（如 deepseek-chat）"
                  value={modelDraft.value}
                  onChange={(e) => modelDraft.setValue(e.target.value)}
                  onBlur={() => void modelDraft.flush().catch(() => {})}
                />
                <Input
                  className="h-8"
                  type="password"
                  autoComplete="off"
                  placeholder="API Key（仅存本机）"
                  value={apiKeyDraft.value}
                  onChange={(e) => apiKeyDraft.setValue(e.target.value)}
                  onBlur={() => void apiKeyDraft.flush().catch(() => {})}
                />
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  )
}

function presetLabel(ws: AgentWorkspace): string | null {
  return PROVIDER_PRESETS.find((p) => p.baseURL === ws.model.baseURL)?.label ?? null
}

function modelSelectionValue(ws: AgentWorkspace): string {
  return ws.model.useGlobal ? GLOBAL_MODEL : (presetLabel(ws) ?? CUSTOM_PRESET)
}

/** 规则引用选择: 全局规则恒生效 (只读列示); 工作空间级规则可勾选加入本工作区 ruleIds。 */
function WorkspaceRulesPicker({ ws }: { ws: AgentWorkspace }) {
  const rules = React.useSyncExternalStore(subscribeRules, getRules, getServerRules)
  const globals = rules.filter((r) => r.scope === "global")
  const wsRules = rules.filter((r) => r.scope === "workspace")
  const refs = new Set(ws.rules.ruleIds)

  function toggle(id: string, on: boolean) {
    void updateWorkspace(ws.id, (current) => {
      const ruleIds = on
        ? Array.from(new Set([...current.rules.ruleIds, id]))
        : current.rules.ruleIds.filter((candidate) => candidate !== id)
      return { ...current, rules: { ruleIds } }
    }).catch(() => toast.error("保存工作区规则失败"))
  }

  return (
    <div className="space-y-2">
      {globals.map((r) => (
        <div key={r.id} className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">全局</span>
          <span className="truncate">{r.name}</span>
        </div>
      ))}
      {wsRules.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          还没有工作区级规则。在左侧「规则」区段新建（范围选「工作区」）。
        </p>
      ) : (
        wsRules.map((r) => (
          <label key={r.id} className="flex items-start gap-2">
            <Checkbox
              checked={refs.has(r.id)}
              onCheckedChange={(v) => toggle(r.id, Boolean(v))}
              className="mt-0.5"
            />
            <span>
              <span className="block text-sm">{r.name}</span>
              {r.description && (
                <span className="block text-xs text-muted-foreground">{r.description}</span>
              )}
            </span>
          </label>
        ))
      )}
    </div>
  )
}
