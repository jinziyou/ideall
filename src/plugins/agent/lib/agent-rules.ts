// 规则注册表 (唯一数据来源) —— 把「规则」从每个工作区内嵌文本提升为顶层、可复用的条目。
// 工作空间按 id 引用全局/工作空间规则 (见 agent-workspace.ts ruleIds)。本地优先 localStorage。
//
// 激活模式 (与 Cursor/Windsurf 1:1): 始终 / 智能判断(按 description 路由) / 按文件(glob) / 手动@。
// scope: global=对所有工作空间生效; workspace=仅被显式引用时生效。

import { genId } from "@/lib/id"
import { createCollection } from "./agent-collection"

export type RuleActivation = "always" | "smart" | "glob" | "manual"
export type RuleScope = "global" | "workspace"

export const RULE_ACTIVATIONS: { value: RuleActivation; label: string; hint: string }[] = [
  { value: "always", label: "始终", hint: "每次对话都注入" },
  { value: "smart", label: "智能判断", hint: "按描述与当前任务相关时注入" },
  { value: "glob", label: "按文件", hint: "命中文件/路径模式时注入" },
  { value: "manual", label: "手动", hint: "仅在 @ 引用时注入" },
]

export interface AgentRule {
  id: string
  name: string
  /** 这段描述很重要: 既是副标题, 也是「智能判断」模式下模型路由的匹配键。 */
  description: string
  activation: RuleActivation
  /** 仅 activation==="glob" 用 (逗号/换行分隔的路径模式)。 */
  glob: string
  /** 规则正文 (markdown)。 */
  body: string
  scope: RuleScope
  enabled: boolean
  createdAt: number
  updatedAt: number
}

function migrate(raw: Partial<AgentRule>): AgentRule {
  const now = Date.now()
  return {
    id: raw.id ?? genId("rule"),
    name: raw.name ?? "未命名规则",
    description: raw.description ?? "",
    activation: raw.activation ?? "always",
    glob: raw.glob ?? "",
    body: raw.body ?? "",
    scope: raw.scope ?? "global",
    enabled: raw.enabled ?? true,
    createdAt: raw.createdAt ?? now,
    updatedAt: raw.updatedAt ?? now,
  }
}

function seed(): AgentRule[] {
  const now = Date.now()
  return [
    migrate({
      id: genId("rule"),
      name: "先结论后展开",
      description: "回答先给结论，再用要点展开，避免长篇铺垫。",
      activation: "always",
      scope: "global",
      body: "回答时先给出明确结论或建议，再用要点或步骤展开论据。中文作答，避免空话与免责声明堆砌。",
      enabled: true,
      createdAt: now,
      updatedAt: now,
    }),
  ]
}

export const AGENT_RULES_STORAGE_KEY = "ideall:agent:rules:v1"
const store = createCollection<AgentRule>(AGENT_RULES_STORAGE_KEY, seed, migrate)

export const subscribeRules = store.subscribe
export const getRules = store.get
export const getServerRules = store.getServer

/** 解析某工作区生效的规则正文: 全部启用的全局规则 + 被引用且启用的工作空间规则。 */
export function activeRulesText(ruleIds: string[] | null): string {
  const all = store.get()
  const refs = new Set(ruleIds ?? [])
  return all
    .filter((r) => r.enabled && (r.scope === "global" || refs.has(r.id)))
    .map((r) => r.body.trim())
    .filter(Boolean)
    .join("\n\n")
}

export function createRule(partial?: Partial<AgentRule>): AgentRule {
  const rule = migrate({ ...partial, id: genId("rule"), createdAt: Date.now() })
  store.upsert(rule)
  return rule
}

export function saveRule(rule: AgentRule): void {
  store.upsert({ ...rule, updatedAt: Date.now() })
}

export function setRuleEnabled(id: string, enabled: boolean): void {
  const r = store.byId(id)
  if (r) store.upsert({ ...r, enabled, updatedAt: Date.now() })
}

export function deleteRule(id: string): void {
  store.remove(id)
}

/**
 * 以一个公开配置快照替换规则注册表。
 *
 * FileSystem / 导入适配器走这个入口而不是直接写 localStorage，确保正在显示的规则 UI
 * 能收到同一条 store 订阅通知，并复用既有的容旧迁移。
 */
export function replaceRules(rules: readonly Partial<AgentRule>[]): void {
  store.replaceAll(rules.map(migrate))
}
