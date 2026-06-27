// 技能注册表 (唯一真源) —— 一个技能 = 一条可调用流程 (指令 + 可选「需当前节点」/「智能体模式」)。
// 触发时把 prompt 当一条 user 消息喂进 send() 回路; 所需「当前节点」上下文由 gatherReferencedContext()
// /buildSystemPrompt() 同一管线注入。技能本身只产「指令文本」, 不改传输/协议/授权层。
//
// 内置技能 (BUILTIN_SKILLS) 作种子; 用户可新增自定义技能、启停、改调用方式。工作空间按 id 引用 (skillIds)。
// 与「规则」分车道: 规则=被动常驻约束, 技能=可调用流程 (见 docs 与 Anthropic Skills doctrine)。
//
// 不走 MCP Prompts: provider==consumer 同进程下那只是把字符串绕 JSON-RPC 一圈; 出现跨进程消费方时再升级。

import { genId } from "@/lib/id"
import { createCollection } from "./agent-collection"

/** 调用方式: auto=模型可按 hint 自动路由; manual=仅用户手动触发。 */
export type SkillInvocation = "auto" | "manual"

export interface AgentSkill {
  id: string
  /** 短名 (技能菜单)。 */
  label: string
  /** 一句说明 (菜单副标题; 也是 auto 模式下模型路由的匹配键 —— 承重)。 */
  hint: string
  /** 发给模型的 user 消息 (技能即一条预置提示)。 */
  prompt: string
  /** 需要当前打开的节点 (note/thread) 作上下文; 缺则触发前提示用户先打开。 */
  needsActiveNode?: boolean
  /** 默认开智能体模式 (要工具读写「我的」数据的技能)。 */
  agentMode?: boolean
  /** 内置技能 (不可删; 可启停)。 */
  builtin?: boolean
  /** 是否启用 (默认 true)。 */
  enabled?: boolean
  /** 调用方式 (默认 auto)。 */
  invocation?: SkillInvocation
}

/** 内置技能种子 (Path B 预置模板)。 */
export const BUILTIN_SKILLS: AgentSkill[] = [
  {
    id: "summarize-active",
    label: "总结当前",
    hint: "概括你正打开的笔记或对话",
    prompt: "请聚焦我当前打开的内容（见上下文），用简洁中文给出摘要与关键要点。",
    needsActiveNode: true,
    builtin: true,
    enabled: true,
    invocation: "manual",
  },
  {
    id: "feed-digest",
    label: "关注速览",
    hint: "根据你关注的来源给条速览",
    prompt: "根据我关注的来源，最近有什么值得关注？给一条简短速览，并按重要性排序。",
    builtin: true,
    enabled: true,
    invocation: "auto",
  },
]

function migrate(raw: Partial<AgentSkill>): AgentSkill {
  return {
    id: raw.id ?? genId("skill"),
    label: raw.label ?? "未命名技能",
    hint: raw.hint ?? "",
    prompt: raw.prompt ?? "",
    needsActiveNode: raw.needsActiveNode,
    agentMode: raw.agentMode,
    builtin: raw.builtin ?? false,
    enabled: raw.enabled ?? true,
    invocation: raw.invocation ?? "auto",
  }
}

const store = createCollection<AgentSkill>(
  "ideall:agent:skills:v1",
  () => BUILTIN_SKILLS.map(migrate),
  migrate,
)

// 内置技能由 seed() 注入 (空存储时); getter 保持纯 (勿在 getSnapshot 内 commit)。
export const subscribeSkills = store.subscribe
export const getSkills = store.get
export const getServerSkills = store.getServer
export const getSkill = store.byId

/** 解析某工作区可用的技能: skillIds=null → 全部启用; 否则取交集且启用。 */
export function resolveSkills(skillIds: string[] | null): AgentSkill[] {
  const all = store.get().filter((s) => s.enabled !== false)
  if (!skillIds) return all
  const set = new Set(skillIds)
  return all.filter((s) => set.has(s.id))
}

export function createSkill(partial?: Partial<AgentSkill>): AgentSkill {
  const s = migrate({ ...partial, id: genId("skill"), builtin: false })
  store.upsert(s)
  return s
}

export function saveSkill(skill: AgentSkill): void {
  store.upsert(skill)
}

export function setSkillEnabled(id: string, enabled: boolean): void {
  const s = store.byId(id)
  if (s) store.upsert({ ...s, enabled })
}

export function deleteSkill(id: string): void {
  const s = store.byId(id)
  if (s?.builtin) return // 内置技能不可删 (可禁用)
  store.remove(id)
}
