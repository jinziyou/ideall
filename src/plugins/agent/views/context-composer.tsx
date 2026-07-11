"use client"

// 上下文组合器: 把一个 AI 工作区的「数据 + 能力 + 规则 + 提示词 + 模型」收敛为可勾选的五组, 每组都有默认。
// 直接读写当前工作区 (saveWorkspace), 改动即时进入 resolveRun (下次发送生效)。
// 安全: 能力位只能在 AGENT_CONFIGURABLE_PERMISSIONS 内选择；敏感配置读取默认关闭。

import * as React from "react"
import { getFilesPort } from "@protocol/files"
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
  saveWorkspace,
  type AgentWorkspace,
  type WorkspaceCapabilities,
  type WorkspaceData,
} from "../lib/agent-workspace"

const APP_OPTIONS = [infoEmbedManifest, communityEmbedManifest]
const APP_IDS = APP_OPTIONS.map((a) => a.id)
const SKILL_IDS = BUILTIN_SKILLS.map((s) => s.id)

const DEFAULT_DIR = "__root__"
const GLOBAL_MODEL = "__global__"
const CUSTOM_PRESET = "__custom__"

const DATA_KINDS: { key: keyof WorkspaceData["home"]; label: string }[] = [
  { key: "notes", label: "笔记" },
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

export default function ContextComposer({ ws }: { ws: AgentWorkspace }) {
  const [folders, setFolders] = React.useState<{ id: string; name: string }[]>([])

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

  const save = (p: Partial<AgentWorkspace>) => saveWorkspace({ ...ws, ...p })
  const patchData = (p: Partial<WorkspaceData>) => save({ data: { ...ws.data, ...p } })
  const patchCaps = (p: Partial<WorkspaceCapabilities>) =>
    save({ capabilities: { ...ws.capabilities, ...p } })

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
              onChange={(v) => patchData({ includeHome: v })}
              label="带上「我的」概览"
            />
            {ws.data.includeHome && (
              <div className="ml-6 grid grid-cols-2 gap-x-3 gap-y-1.5">
                {DATA_KINDS.map((k) => (
                  <Row
                    key={k.key}
                    checked={ws.data.home[k.key]}
                    onChange={(v) => patchData({ home: { ...ws.data.home, [k.key]: v } })}
                    label={k.label}
                  />
                ))}
              </div>
            )}
            <div className="space-y-1.5 pt-1">
              <Label className="text-xs">本地目录</Label>
              <Select
                value={ws.data.dirNodeId ?? DEFAULT_DIR}
                onValueChange={(v) => patchData({ dirNodeId: v === DEFAULT_DIR ? null : v })}
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
                value={ws.data.osDir ?? ""}
                onChange={(e) => patchData({ osDir: e.target.value || null })}
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
                    patchCaps({
                      permissions: v
                        ? [...new Set([...ws.capabilities.permissions, c.perm])]
                        : ws.capabilities.permissions.filter((p) => p !== c.perm),
                    })
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
                    patchCaps({ skillIds: toggleNullable(skillIds, SKILL_IDS, s.id, v) })
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
                  onChange={(v) => patchCaps({ appIds: toggleNullable(appIds, APP_IDS, a.id, v) })}
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
              value={ws.prompt.instructions}
              onChange={(e) => save({ prompt: { ...ws.prompt, instructions: e.target.value } })}
            />
          </Section>

          {/* —— 模型 —— */}
          <Section title="模型">
            <Select
              value={ws.model.useGlobal ? GLOBAL_MODEL : (presetLabel(ws) ?? CUSTOM_PRESET)}
              onValueChange={(v) => {
                if (v === GLOBAL_MODEL) {
                  save({ model: { ...ws.model, useGlobal: true } })
                } else if (v === CUSTOM_PRESET) {
                  save({ model: { ...ws.model, useGlobal: false } })
                } else {
                  const p = PROVIDER_PRESETS.find((x) => x.label === v)
                  if (p)
                    save({
                      model: {
                        ...ws.model,
                        useGlobal: false,
                        baseURL: p.baseURL,
                        model: p.model || ws.model.model,
                      },
                    })
                }
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
                  value={ws.model.baseURL}
                  onChange={(e) => save({ model: { ...ws.model, baseURL: e.target.value } })}
                />
                <Input
                  className="h-8"
                  placeholder="模型名（如 deepseek-chat）"
                  value={ws.model.model}
                  onChange={(e) => save({ model: { ...ws.model, model: e.target.value } })}
                />
                <Input
                  className="h-8"
                  type="password"
                  autoComplete="off"
                  placeholder="API Key（仅存本机）"
                  value={ws.model.apiKey}
                  onChange={(e) => save({ model: { ...ws.model, apiKey: e.target.value } })}
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

/** 规则引用选择: 全局规则恒生效 (只读列示); 工作空间级规则可勾选加入本工作区 ruleIds。 */
function WorkspaceRulesPicker({ ws }: { ws: AgentWorkspace }) {
  const rules = React.useSyncExternalStore(subscribeRules, getRules, getServerRules)
  const globals = rules.filter((r) => r.scope === "global")
  const wsRules = rules.filter((r) => r.scope === "workspace")
  const refs = new Set(ws.rules.ruleIds)

  function toggle(id: string, on: boolean) {
    const next = on
      ? Array.from(new Set([...ws.rules.ruleIds, id]))
      : ws.rules.ruleIds.filter((x) => x !== id)
    saveWorkspace({ ...ws, rules: { ruleIds: next } })
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
