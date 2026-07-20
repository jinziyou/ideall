"use client"

// 规则注册表标签 (kind:"ai-rules")。被动约束的唯一数据来源 —— 全局规则恒生效;
// 工作空间规则仅被工作空间引用时生效。主列表(全局/工作空间分组) + 选中项的详情编辑器。
// 本地优先: 改动即经 rules 配置文件的 CAS 写回，无「保存」按钮。

import * as React from "react"
import { ScrollText, Trash2 } from "lucide-react"
import { genId } from "@/lib/id"
import { useFileDocument } from "@/shared/use-file-document"
import { Button } from "@/ui/button"
import { Chip } from "@/ui/chip"
import { EmptyState } from "@/ui/empty-state"
import { Input } from "@/ui/input"
import { Label } from "@/ui/label"
import { Panel } from "@/ui/panel"
import { Textarea } from "@/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select"
import { Switch } from "@/ui/switch"
import { agentConfigFileRef } from "../agent-config-file-system"
import { decodeAgentRules } from "../lib/agent-config-codecs"
import { AddButton, AiPage, ListRow } from "./ui-kit"
import {
  RULE_ACTIVATIONS,
  type AgentRule,
  type RuleActivation,
  type RuleScope,
} from "../lib/agent-rules"

const RULES_FILE_REF = agentConfigFileRef("rules")

const activationLabel = (a: RuleActivation) =>
  RULE_ACTIVATIONS.find((x) => x.value === a)?.label ?? a

export default function AiRules() {
  const document = useFileDocument(RULES_FILE_REF, decodeAgentRules)
  const updateRules = document.update
  const rules = document.data ?? []
  const [selectedId, setSelected] = React.useState<string | null>(null)
  const selected = rules.find((r) => r.id === selectedId) ?? null

  const globalRules = rules.filter((r) => r.scope === "global")
  const workspaceRules = rules.filter((r) => r.scope === "workspace")

  function createRule() {
    const id = genId("rule")
    const createdAt = Date.now()
    const rule: AgentRule = {
      id,
      name: "新规则",
      description: "",
      activation: "always",
      glob: "",
      body: "",
      scope: "global",
      enabled: true,
      createdAt,
      updatedAt: Date.now(),
    }
    void updateRules((current) => [...current, rule])
      .then(() => setSelected(id))
      .catch(() => {})
  }

  function update(patch: Partial<AgentRule>) {
    if (!selected) return
    const id = selected.id
    const updatedAt = Date.now()
    void updateRules((current) =>
      current.map((rule) => (rule.id === id ? { ...rule, ...patch, updatedAt } : rule)),
    ).catch(() => {})
  }

  function setRuleEnabled(id: string, enabled: boolean, updatedAt: number) {
    void updateRules((current) =>
      current.map((rule) => (rule.id === id ? { ...rule, enabled, updatedAt } : rule)),
    ).catch(() => {})
  }

  function deleteRule(id: string) {
    void updateRules((current) => current.filter((rule) => rule.id !== id))
      .then(() => setSelected((current) => (current === id ? null : current)))
      .catch(() => {})
  }

  function retryRead() {
    void document.refresh().catch(() => {})
  }

  function renderList(list: AgentRule[]) {
    if (list.length === 0) {
      return <p className="text-[13px] text-muted-foreground">还没有规则</p>
    }
    return (
      <div className="space-y-2">
        {list.map((rule) => (
          <ListRow
            key={rule.id}
            leading={<ScrollText className="h-4 w-4 text-muted-foreground" />}
            title={rule.name}
            subtitle={rule.description}
            active={rule.id === selectedId}
            onClick={() => setSelected(rule.id)}
            trailing={
              <>
                <Chip>{activationLabel(rule.activation)}</Chip>
                <Switch
                  checked={rule.enabled}
                  onChange={(v) => setRuleEnabled(rule.id, v, Date.now())}
                  label={`启用 ${rule.name}`}
                />
              </>
            }
          />
        ))}
      </div>
    )
  }

  return (
    <AiPage
      title="规则"
      icon={ScrollText}
      action={
        <>
          {document.saving ? <Chip>保存中…</Chip> : null}
          {document.data ? <AddButton label="新建规则" onClick={createRule} /> : null}
        </>
      }
    >
      {document.loading && !document.data ? (
        <p className="py-12 text-center text-sm text-muted-foreground">正在读取规则…</p>
      ) : document.error && !document.data ? (
        <EmptyState
          icon={ScrollText}
          title="规则读取失败"
          description="文件系统暂不可用，请稍后重试。"
          variant="halo"
          bordered={false}
          action={
            <Button type="button" variant="outline" size="sm" onClick={retryRead}>
              重新读取
            </Button>
          }
        />
      ) : (
        <div className="space-y-8">
          {document.error ? (
            <div
              role="alert"
              className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
            >
              <span>规则配置未能保存，请重新读取后再试。</span>
              <Button type="button" variant="outline" size="sm" onClick={retryRead}>
                重试读取
              </Button>
            </div>
          ) : null}
          <Panel title="全局规则">{renderList(globalRules)}</Panel>
          <Panel title="工作区规则">{renderList(workspaceRules)}</Panel>

          {selected && (
            <Panel title="编辑规则">
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="rule-name">名称</Label>
                  <Input
                    id="rule-name"
                    value={selected.name}
                    onChange={(e) => update({ name: e.target.value })}
                    placeholder="规则名称"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="rule-desc">描述</Label>
                  <Input
                    id="rule-desc"
                    value={selected.description}
                    onChange={(e) => update({ description: e.target.value })}
                    placeholder="一句话说明（「智能判断」模式下用作匹配键）"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>激活</Label>
                  <Select
                    value={selected.activation}
                    onValueChange={(v) => update({ activation: v as RuleActivation })}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RULE_ACTIVATIONS.map((a) => (
                        <SelectItem key={a.value} value={a.value}>
                          {a.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[13px] text-muted-foreground">
                    {RULE_ACTIVATIONS.find((x) => x.value === selected.activation)?.hint}
                  </p>
                </div>

                {selected.activation === "glob" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="rule-glob">文件模式</Label>
                    <Input
                      id="rule-glob"
                      value={selected.glob}
                      onChange={(e) => update({ glob: e.target.value })}
                      placeholder="例如 src/**/*.ts, *.md（逗号或换行分隔）"
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label>范围</Label>
                  <Select
                    value={selected.scope}
                    onValueChange={(v) => update({ scope: v as RuleScope })}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="global">全局</SelectItem>
                      <SelectItem value="workspace">工作区</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="rule-body">正文</Label>
                  <Textarea
                    id="rule-body"
                    rows={6}
                    value={selected.body}
                    onChange={(e) => update({ body: e.target.value })}
                    placeholder="规则正文（markdown）"
                  />
                </div>

                <div className="flex justify-end pt-1">
                  <Button variant="destructive" size="sm" onClick={() => deleteRule(selected.id)}>
                    <Trash2 className="mr-1.5 h-4 w-4" />
                    删除
                  </Button>
                </div>
              </div>
            </Panel>
          )}
        </div>
      )}
    </AiPage>
  )
}
