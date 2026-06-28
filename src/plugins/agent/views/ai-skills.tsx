"use client"

// Skills 注册表视图 —— 管理「可调用流程」: 一段预置指令 + 可选「需当前节点 / 智能体模式」。
// 主从布局: 上方技能列表 (ListRow), 下方所选技能的详情编辑器 (Panel)。与「规则」分车道。

import * as React from "react"
import { Sparkles } from "lucide-react"

import {
  getSkills,
  subscribeSkills,
  getServerSkills,
  createSkill,
  saveSkill,
  setSkillEnabled,
  deleteSkill,
  type AgentSkill,
} from "../lib/agent-skills"
import { AddButton, AiPage, Chip, EmptyState, ListRow, Panel, Toggle } from "./ui-kit"

import { Button } from "@/ui/button"
import { Checkbox } from "@/ui/checkbox"
import { Input } from "@/ui/input"
import { Label } from "@/ui/label"
import { Textarea } from "@/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select"

export default function AiSkills() {
  const skills = React.useSyncExternalStore(subscribeSkills, getSkills, getServerSkills)
  const [selectedId, setSelectedId] = React.useState<string | null>(() => skills[0]?.id ?? null)

  const selected = React.useMemo<AgentSkill | null>(
    () => skills.find((s) => s.id === selectedId) ?? null,
    [skills, selectedId],
  )

  function patch(field: Partial<AgentSkill>) {
    if (!selected) return
    saveSkill({ ...selected, ...field })
  }

  return (
    <AiPage
      title="Skills"
      icon={Sparkles}
      action={
        <AddButton
          label="新建技能"
          onClick={() => {
            const s = createSkill({ label: "新技能" })
            setSelectedId(s.id)
          }}
        />
      }
    >
      {skills.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="还没有技能"
          action={
            <AddButton
              label="新建技能"
              onClick={() => {
                const s = createSkill({ label: "新技能" })
                setSelectedId(s.id)
              }}
            />
          }
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
                    <Toggle
                      checked={skill.enabled !== false}
                      onChange={(v) => setSkillEnabled(skill.id, v)}
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
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      deleteSkill(selected.id)
                      setSelectedId(null)
                    }}
                  >
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
                  <Label htmlFor="skill-hint">说明</Label>
                  <Input
                    id="skill-hint"
                    value={selected.hint}
                    disabled={selected.builtin}
                    onChange={(e) => patch({ hint: e.target.value })}
                    placeholder="一句说明"
                  />
                  <p className="text-[13px] leading-relaxed text-muted-foreground">
                    描述承重：也是「自动」模式下模型路由的匹配键。
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
        </div>
      )}
    </AiPage>
  )
}
