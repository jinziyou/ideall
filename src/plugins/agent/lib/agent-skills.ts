// 技能注册表 (唯一数据来源) —— 一个技能 = 一条可调用流程 (指令 + 可选上下文门槛 / 智能体模式)。
// 触发时把 prompt 当一条 user 消息喂进 send() 回路；需要当前节点的技能会先把该节点显式加入可见上下文托盘。
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
  /** 一句说明 (菜单副标题; 也是 auto 模式下模型路由的匹配键 —— 这条说明很重要)。 */
  hint: string
  /** 发给模型的 user 消息 (技能即一条预置提示)。 */
  prompt: string
  /** 需要当前打开的节点 (note/thread) 作上下文; 缺则触发前提示用户先打开。 */
  needsActiveNode?: boolean
  /** 手动运行前至少需要多少项显式上下文；研究模板用它阻止无资料的泛化回答。 */
  minContextItems?: number
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
    id: "summarize-sources",
    label: "资料总结",
    hint: "总结上下文托盘中的一项或多项资料",
    prompt:
      "只根据我明确选择的上下文资料生成总结：先给一句结论，再列关键要点、分歧或缺口；重要判断标注对应的 [来源 key]，不要用未提供的事实补全。",
    minContextItems: 1,
    builtin: true,
    enabled: true,
    invocation: "manual",
  },
  {
    id: "compare-sources",
    label: "资料比较",
    hint: "比较至少两项已选资料的共识与差异",
    prompt:
      "比较我明确选择的上下文资料。按比较维度输出紧凑表格，再总结共识、差异、各自证据与待核实问题；每项关键判断标注 [来源 key]，资料没有覆盖的内容明确写未知。",
    minContextItems: 2,
    builtin: true,
    enabled: true,
    invocation: "manual",
  },
  {
    id: "timeline-sources",
    label: "资料时间线",
    hint: "从已选资料提取有证据的事件时间线",
    prompt:
      "从我明确选择的上下文资料中提取时间线。按时间升序列出日期、事件、影响和 [来源 key]；无法确定的日期单列为“时间待确认”，不要臆测缺失日期。",
    minContextItems: 1,
    builtin: true,
    enabled: true,
    invocation: "manual",
  },
  {
    id: "research-report",
    label: "研究报告",
    hint: "用至少两项已选资料生成可落地的研究报告",
    prompt:
      "只使用我明确选择的上下文资料撰写研究报告。结构为：执行摘要、问题与范围、证据与发现、相互矛盾的信息、结论、下一步；关键事实标注 [来源 key]，把推断和原文事实分开，并列出资料缺口。",
    minContextItems: 2,
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
    minContextItems:
      Number.isSafeInteger(raw.minContextItems) &&
      Number(raw.minContextItems) >= 1 &&
      Number(raw.minContextItems) <= 8
        ? Number(raw.minContextItems)
        : undefined,
    agentMode: raw.agentMode,
    builtin: raw.builtin ?? false,
    enabled: raw.enabled ?? true,
    invocation: raw.invocation ?? "auto",
  }
}

function normalizeSkills(skills: AgentSkill[]): AgentSkill[] {
  const builtinIds = new Set(BUILTIN_SKILLS.map((skill) => skill.id))
  const builtins = BUILTIN_SKILLS.map((fallback) => {
    const supplied = skills.find((skill) => skill.id === fallback.id)
    return migrate(
      supplied ? { ...fallback, ...supplied, id: fallback.id, builtin: true } : fallback,
    )
  })
  return [...builtins, ...skills.filter((skill) => !builtinIds.has(skill.id) && !skill.builtin)]
}

export const AGENT_SKILLS_STORAGE_KEY = "ideall:agent:skills:v1"
const store = createCollection<AgentSkill>(
  AGENT_SKILLS_STORAGE_KEY,
  () => BUILTIN_SKILLS.map(migrate),
  migrate,
  { normalizeLoaded: normalizeSkills },
)

// 内置技能由 seed() 注入 (空存储时); getter 保持纯 (勿在 getSnapshot 内 commit)。
export const subscribeSkills = store.subscribe
export const getSkills = store.get
export const getServerSkills = store.getServer

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

/** 用公开配置快照替换技能注册表，同时保留内置技能的稳定身份。 */
export function replaceSkills(skills: readonly Partial<AgentSkill>[]): void {
  const migrated = skills.map(migrate)
  store.replaceAll(normalizeSkills(migrated))
}
