"use client"

// 上下文组合器: 把一个 AI 工作区的「数据 + 能力 + 规则 + 提示词 + 模型」收敛为可勾选的五组, 每组都有默认。
// 直接读写当前工作区 (saveWorkspace), 改动即时进入 resolveRun (下次发送生效)。
// 安全: 能力位只能在 AGENT_PERMISSIONS 内收窄 (agentGrant 取交集); 不暴露 fs.notes:read/fs.blobs:read (隐私三闸)。

import * as React from "react"
import { getFilesPort } from "@protocol/files"
import { Checkbox } from "@/ui/checkbox"
import { Input } from "@/ui/input"
import { Label } from "@/ui/label"
import { Textarea } from "@/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select"
import type { Permission } from "@/plugins/embed/protocol"
import { infoEmbedManifest, communityEmbedManifest } from "@/plugins/embed/manifest"
import { BUILTIN_SKILLS } from "../lib/agent-skills"
import { PROVIDER_PRESETS } from "../lib/agent-settings"
import {
  saveWorkspace,
  type AgentWorkspace,
  type WorkspaceCapabilities,
  type WorkspaceData,
} from "../lib/agent-workspace"

// 能力位 → 友好标签 (顺序 = AGENT_PERMISSIONS; 只列 agent 默认集, 不含私密读位)。
const CAPABILITY_OPTIONS: { perm: Permission; label: string; hint: string }[] = [
  { perm: "fs:read", label: "读取「我的」", hint: "列出关注 / 书签 / 资源 / 笔记标题" },
  { perm: "fs:write", label: "修改「我的」", hint: "增改书签 / 收藏夹 / 关注" },
  { perm: "fs.notes:write", label: "写入笔记", hint: "新建 / 编辑笔记" },
  { perm: "ui.tabs", label: "打开标签", hint: "把节点物化为工作区标签" },
  { perm: "web:search", label: "联网搜索", hint: "web.search 搜索引擎" },
  { perm: "web:fetch", label: "抓取网页", hint: "web.fetch 读取网页正文" },
]

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

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-2.5 border-b pb-4">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function Row({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint?: string
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
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
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
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
        {/* —— 数据 —— */}
        <Section title="数据" hint="把「我的」与本地目录作为上下文（默认全部）">
          <Row
            checked={ws.data.includeHome}
            onChange={(v) => patchData({ includeHome: v })}
            label="带上「我的」概览"
            hint="仅标题 / 元数据，正文需 @ 引用单条授权"
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
        <Section title="能力" hint="MCP 工具 / 技能 / 应用（默认全部）">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">工具（智能体模式下可调用）</p>
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
                hint={c.hint}
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
                hint={s.hint}
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
            <p className="text-xs text-muted-foreground">
              应用与外部 MCP 接入随后开放；当前先记录选择。
            </p>
          </div>
        </Section>

        {/* —— 规则 —— */}
        <Section title="规则与示例" hint="期望助手遵循的约束与示范">
          <div className="space-y-1.5">
            <Label className="text-xs">规则</Label>
            <Textarea
              rows={3}
              placeholder="例如：回答先给结论再给依据；不要编造来源…"
              value={ws.rules.rules}
              onChange={(e) => save({ rules: { ...ws.rules, rules: e.target.value } })}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">示例</Label>
            <Textarea
              rows={3}
              placeholder="可贴入示范问答，供助手参照风格…"
              value={ws.rules.examples}
              onChange={(e) => save({ rules: { ...ws.rules, examples: e.target.value } })}
            />
          </div>
        </Section>

        {/* —— 提示词 —— */}
        <Section title="提示词 / 指令" hint="高优先的工作区指令（拼接模板见「精确模式」）">
          <Textarea
            rows={3}
            placeholder="例如：你是我的科研助理，围绕本工作目录的资料作答…"
            value={ws.prompt.instructions}
            onChange={(e) => save({ prompt: { ...ws.prompt, instructions: e.target.value } })}
          />
        </Section>

        {/* —— 模型 —— */}
        <Section title="模型" hint="默认沿用全局设置，可按工作区覆盖">
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
  )
}

function presetLabel(ws: AgentWorkspace): string | null {
  return PROVIDER_PRESETS.find((p) => p.baseURL === ws.model.baseURL)?.label ?? null
}
