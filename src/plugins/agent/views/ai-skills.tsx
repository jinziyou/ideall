"use client"

// Skills 注册表视图 —— 管理「可调用流程」: 一段预置指令 + 可选上下文门槛 / 智能体模式。
// 主从布局: 上方技能列表 (ListRow), 下方所选技能的详情编辑器 (Panel)。与「规则」分车道。

import * as React from "react"
import { Sparkles } from "lucide-react"
import { toast } from "sonner"
import { genId } from "@/lib/id"
import { useFileDocument } from "@/shared/use-file-document"
import { Chip } from "@/ui/chip"
import { Panel } from "@/ui/panel"
import { Switch } from "@/ui/switch"

import { agentConfigFileRef } from "../agent-config-file-system"
import { decodeAgentSkills } from "../lib/agent-config-codecs"
import type { AgentSkill } from "../lib/agent-skills"
import { AddButton, AiPage, ListRow } from "./ui-kit"
import { EmptyState } from "@/ui/empty-state"

import { Button } from "@/ui/button"
import { Checkbox } from "@/ui/checkbox"
import { Input } from "@/ui/input"
import { Label } from "@/ui/label"
import { Textarea } from "@/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select"

const SKILLS_FILE_REF = agentConfigFileRef("skills")

function createCustomSkill(): AgentSkill {
  return {
    id: genId("skill"),
    label: "新技能",
    hint: "",
    prompt: "",
    needsActiveNode: undefined,
    minContextItems: undefined,
    agentMode: undefined,
    builtin: false,
    enabled: true,
    invocation: "auto",
  }
}

function reportSkillsWriteError(error: unknown): void {
  toast.error("技能配置保存失败", {
    id: "agent-skills-write-error",
    description: error instanceof Error ? error.message : String(error),
  })
}

export default function AiSkills() {
  const document = useFileDocument(SKILLS_FILE_REF, decodeAgentSkills)
  const updateSkills = document.update
  const skills = document.data ?? []
  const [selectedId, setSelectedId] = React.useState<string | null>(null)

  const selected: AgentSkill | null =
    skills.find((skill) => skill.id === selectedId) ?? skills[0] ?? null

  function patch(field: Partial<AgentSkill>) {
    if (!selected) return
    const id = selected.id
    void updateSkills((current) =>
      current.map((skill) =>
        skill.id === id ? { ...skill, ...field, id, builtin: skill.builtin } : skill,
      ),
    ).catch(reportSkillsWriteError)
  }

  function addSkill() {
    const created = createCustomSkill()
    void updateSkills((current) => [...current, created])
      .then(() => setSelectedId(created.id))
      .catch(reportSkillsWriteError)
  }

  function toggleSkill(id: string, enabled: boolean) {
    void updateSkills((current) =>
      current.map((skill) => (skill.id === id ? { ...skill, enabled } : skill)),
    ).catch(reportSkillsWriteError)
  }

  function removeSkill(id: string) {
    void updateSkills((current) =>
      current.filter((skill) => skill.id !== id || skill.builtin === true),
    )
      .then(() => setSelectedId((current) => (current === id ? null : current)))
      .catch(reportSkillsWriteError)
  }

  function retryLoad() {
    document.clearError()
    void document.refresh().catch(() => {})
  }

  return (
    <AiPage
      title="Skills"
      icon={Sparkles}
      action={
        <>
          {document.saving ? <Chip tone="neutral">保存中</Chip> : null}
          {document.error ? <Chip tone="error">操作失败</Chip> : null}
          {document.data !== null ? <AddButton label="新建技能" onClick={addSkill} /> : null}
        </>
      }
    >
      {document.loading && document.data === null ? (
        <EmptyState icon={Sparkles} title="正在读取技能…" variant="halo" bordered={false} />
      ) : document.data === null ? (
        <EmptyState
          icon={Sparkles}
          title="技能配置读取失败"
          description="请检查文件系统状态后重试。"
          variant="halo"
          bordered={false}
          action={
            <Button type="button" variant="outline" size="sm" onClick={retryLoad}>
              重试
            </Button>
          }
        />
      ) : skills.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="还没有技能"
          variant="halo"
          bordered={false}
          action={<AddButton label="新建技能" onClick={addSkill} />}
        />
      ) : (
        <div className="space-y-8">
          <div className="space-y-2">
            {skills.map((skill) => (
              <ListRow
                key={skill.id}
                active={skill.id === selectedId}
                onClick={() => setSelectedId(skill.id)}
                leading={<Sparkles className="h-4 w-4 text-muted-foreground" />}
                title={skill.label}
                subtitle={skill.hint}
                trailing={
                  <>
                    <Chip>{skill.builtin ? "内置" : "自定义"}</Chip>
                    <Chip tone="neutral">{skill.invocation === "manual" ? "手动" : "自动"}</Chip>
                    <Switch
                      checked={skill.enabled !== false}
                      onChange={(enabled) => toggleSkill(skill.id, enabled)}
                      label={`启用 ${skill.label}`}
                    />
                  </>
                }
              />
            ))}
          </div>

          {selected && (
            <Panel
              title={selected.label || "未命名技能"}
              action={
                !selected.builtin ? (
                  <Button variant="destructive" size="sm" onClick={() => removeSkill(selected.id)}>
                    删除
                  </Button>
                ) : undefined
              }
            >
              <div className="space-y-5">
                <div className="space-y-1.5">
                  <Label htmlFor="skill-label">短名</Label>
                  <Input
                    id="skill-label"
                    value={selected.label}
                    disabled={selected.builtin}
                    onChange={(e) => patch({ label: e.target.value })}
                    placeholder="技能短名"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="skill-context-minimum">显式上下文要求</Label>
                  <Select
                    value={String(selected.minContextItems ?? 0)}
                    disabled={selected.builtin}
                    onValueChange={(value) =>
                      patch({ minContextItems: value === "0" ? undefined : Number(value) })
                    }
                  >
                    <SelectTrigger id="skill-context-minimum" className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">不要求</SelectItem>
                      {Array.from({ length: 8 }, (_, index) => index + 1).map((count) => (
                        <SelectItem key={count} value={String(count)}>
                          至少 {count} 项资料
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[13px] leading-relaxed text-muted-foreground">
                    不足时不会发送请求；只计算上下文托盘中明确选择的资料。
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="skill-hint">说明</Label>
                  <Input
                    id="skill-hint"
                    value={selected.hint}
                    disabled={selected.builtin}
                    onChange={(e) => patch({ hint: e.target.value })}
                    placeholder="一句说明"
                  />
                  <p className="text-[13px] leading-relaxed text-muted-foreground">
                    这段描述很重要：「自动」模式下也用它来匹配模型。
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="skill-prompt">指令</Label>
                  <Textarea
                    id="skill-prompt"
                    rows={4}
                    value={selected.prompt}
                    disabled={selected.builtin}
                    onChange={(e) => patch({ prompt: e.target.value })}
                    placeholder="发给模型的 user 消息"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="skill-invocation">调用方式</Label>
                  <Select
                    value={selected.invocation ?? "auto"}
                    onValueChange={(v) => patch({ invocation: v as AgentSkill["invocation"] })}
                  >
                    <SelectTrigger id="skill-invocation" className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">自动（模型可按说明路由）</SelectItem>
                      <SelectItem value="manual">手动（仅用户触发）</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-3">
                  <label className="flex items-center gap-3">
                    <Checkbox
                      checked={selected.needsActiveNode === true}
                      onCheckedChange={(v) => patch({ needsActiveNode: v === true })}
                    />
                    <span className="text-sm font-medium">需当前打开的节点</span>
                  </label>
                  <label className="flex items-center gap-3">
                    <Checkbox
                      checked={selected.agentMode === true}
                      onCheckedChange={(v) => patch({ agentMode: v === true })}
                    />
                    <span className="text-sm font-medium">默认开智能体模式</span>
                  </label>
                </div>
              </div>
            </Panel>
          )}

          {document.error ? (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
            >
              <span>技能配置操作失败，已保留最近一次可用内容。</span>
              <Button type="button" variant="outline" size="sm" onClick={retryLoad}>
                重试
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </AiPage>
  )
}
