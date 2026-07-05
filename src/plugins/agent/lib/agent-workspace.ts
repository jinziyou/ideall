// AI 智能体「工作区」模型与存储 —— 把 (数据 + 能力 + 规则 + 提示词 + 模型) 收敛为一个可复用、可命名的工作区。
// 本地优先: 工作区索引存 localStorage (不入 IndexedDB / 不跨端同步 —— MVP);
// 工作区模型覆盖 API Key 走 secure-store, 索引 JSON 只保留非敏感字段。
// 纯 store + subscribe/get (不引 React): 组件侧自行 useSyncExternalStore (与 agent-settings.ts 一致)。
//
// 安全不变量 (见 agent-context.ts / embed/grant.ts):
//   - 能力位只能在 AGENT_PERMISSIONS 内**收窄** (agentGrant 取交集, 越权=工具不存在); 工作区无法扩权。
//   - 「我的」数据默认只取标题概览; 正文仍须 @ 引用单条 consent (工作区不绕过隐私三闸)。

import { genId } from "@/lib/id"
import { secureDelete, secureFallbackGet, secureGet, secureSet } from "@/lib/secure-store"
import { isTauri } from "@/lib/tauri"
import type { Permission } from "@/plugins/embed/protocol"
import { AGENT_PERMISSIONS } from "@/plugins/embed/grant"
import type { HomeSelection } from "./agent-context"
import { getAgentSettings } from "./agent-settings"
import { activeRulesText } from "./agent-rules"

export const AGENT_WORKSPACES_STORAGE_KEY = "ideall:agent:workspaces:v1"

/** 数据组: 「我的」概览 + 本地目录。 */
export interface WorkspaceData {
  /** 是否带「我的」概览快照 (默认 true)。 */
  includeHome: boolean
  /** 选中的「我的」类目 (默认全选)。 */
  home: Required<HomeSelection>
  /** 本地目录 = 「我的」命名空间下某收藏夹 / 笔记父节点 id; null = 默认目录 (home 根)。 */
  dirNodeId: string | null
  /** 真实 OS 目录路径 (桌面端可选源; 未启用 fs 能力时仅记录、不读取)。 */
  osDir: string | null
}

/** 能力组: MCP / 工具 / 技能 / 应用。 */
export interface WorkspaceCapabilities {
  /** 启用的能力位 (默认 = 全部 AGENT_PERMISSIONS; agentGrant 再与默认集取交集)。 */
  permissions: Permission[]
  /** 工具名白名单 (null = 全部已授权工具)。 */
  toolAllowlist: string[] | null
  /** 选中的技能 id (null = 全部内置技能)。 */
  skillIds: string[] | null
  /** 选中的嵌入应用 id (null = 全部; MVP 仅展示, 暂不参与运行)。 */
  appIds: string[] | null
}

/** 规则组: 引用顶层规则注册表的工作空间级规则 id (全局规则恒生效, 不必列入)。 */
export interface WorkspaceRules {
  ruleIds: string[]
}

/** 提示词组: 用户指令 + 精确模式拼接模板 + 最终提示覆盖。 */
export interface WorkspacePrompt {
  /** 用户提示词 / 指令 (高优先, 作为指令注入)。 */
  instructions: string
  /** 拼接模板 (空 = 默认模板; 精确模式可整体改写)。 */
  template: string
  /** 精确模式: 是否按 override「原样发送」最终系统提示 (冻结数据快照)。 */
  precise: boolean
  /** 精确模式下用户可见可改的最终系统提示; precise=true 且非空时按其原样发送, 否则按模板动态拼装。 */
  override: string
}

/** 模型组: 全局设置 或 本工作区覆盖。 */
export interface WorkspaceModel {
  /** true = 复用全局 AgentSettings; false = 用本工作区覆盖。 */
  useGlobal: boolean
  baseURL: string
  model: string
  /** 覆盖时的 key (仅存本地, 永不外发到模型端点以外)。 */
  apiKey: string
}

/** 一个可复用的 AI 工作区 = 数据 + 能力 + 规则 + 提示词 + 模型。 */
export interface AgentWorkspace {
  id: string
  name: string
  data: WorkspaceData
  capabilities: WorkspaceCapabilities
  rules: WorkspaceRules
  prompt: WorkspacePrompt
  model: WorkspaceModel
  createdAt: number
  updatedAt: number
}

export interface WorkspacesState {
  workspaces: AgentWorkspace[]
  activeId: string
}

const ALL_HOME_SELECTED: Required<HomeSelection> = {
  notes: true,
  subscriptions: true,
  bookmarks: true,
  folders: true,
  files: true,
}

/** 一个全默认的工作区 (数据全选 / 能力全开 / 规则空 / 模型走全局)。 */
export function defaultWorkspace(name = "默认工作区"): AgentWorkspace {
  const now = Date.now()
  return {
    id: genId("ws"),
    name,
    data: { includeHome: true, home: { ...ALL_HOME_SELECTED }, dirNodeId: null, osDir: null },
    capabilities: {
      permissions: [...AGENT_PERMISSIONS],
      toolAllowlist: null,
      skillIds: null,
      appIds: null,
    },
    rules: { ruleIds: [] },
    prompt: { instructions: "", template: "", precise: false, override: "" },
    model: { useGlobal: true, baseURL: "", model: "", apiKey: "" },
    createdAt: now,
    updatedAt: now,
  }
}

/** 容旧: 与默认结构深合并, 容忍缺字段 / 旧版本数据。 */
function migrate(w: Partial<AgentWorkspace>): AgentWorkspace {
  const d = defaultWorkspace(w.name ?? undefined)
  return {
    ...d,
    ...w,
    id: w.id ?? d.id,
    name: w.name ?? d.name,
    data: {
      ...d.data,
      ...(w.data ?? {}),
      home: { ...d.data.home, ...(w.data?.home ?? {}) },
    },
    capabilities: { ...d.capabilities, ...(w.capabilities ?? {}) },
    rules: { ruleIds: Array.isArray(w.rules?.ruleIds) ? w.rules!.ruleIds : [] },
    prompt: { ...d.prompt, ...(w.prompt ?? {}) },
    model: { ...d.model, ...(w.model ?? {}) },
    createdAt: w.createdAt ?? d.createdAt,
    updatedAt: w.updatedAt ?? d.updatedAt,
  }
}

// —— store (in-memory 权威 + localStorage 持久化) ——

const SERVER_STATE: WorkspacesState = { workspaces: [], activeId: "" }
let state: WorkspacesState | null = null
const listeners = new Set<() => void>()
const workspaceApiKeyCache = new Map<string, string>()
let secureHydrated = false
let secureHydrating: Promise<void> | null = null

function workspaceApiKeySecureKey(id: string): string {
  return `ideall:agent:workspace:${id}:apiKey`
}

function publicWorkspace(ws: AgentWorkspace): AgentWorkspace {
  return { ...ws, model: { ...ws.model, apiKey: "" } }
}

function publicState(s: WorkspacesState): WorkspacesState {
  return { ...s, workspaces: s.workspaces.map(publicWorkspace) }
}

function materializeWorkspaceApiKey(ws: AgentWorkspace): AgentWorkspace {
  const key = workspaceApiKeySecureKey(ws.id)
  const fallback = secureFallbackGet(key)
  if (fallback) workspaceApiKeyCache.set(ws.id, fallback)
  else if (!isTauri() && ws.model.apiKey) {
    workspaceApiKeyCache.set(ws.id, ws.model.apiKey)
  }
  return {
    ...ws,
    model: {
      ...ws.model,
      apiKey: workspaceApiKeyCache.get(ws.id) ?? (isTauri() ? "" : ws.model.apiKey) ?? "",
    },
  }
}

function persistWorkspaceApiKey(ws: AgentWorkspace): void {
  const key = workspaceApiKeySecureKey(ws.id)
  if (ws.model.useGlobal) {
    workspaceApiKeyCache.delete(ws.id)
    void secureDelete(key)
    return
  }
  if (ws.model.apiKey) {
    workspaceApiKeyCache.set(ws.id, ws.model.apiKey)
    void secureSet(key, ws.model.apiKey)
    return
  }
  if (!secureHydrated && !workspaceApiKeyCache.has(ws.id) && !secureFallbackGet(key)) {
    return
  }
  workspaceApiKeyCache.delete(ws.id)
  void secureDelete(key)
}

function load(): WorkspacesState {
  if (typeof localStorage === "undefined") return SERVER_STATE
  try {
    const raw = localStorage.getItem(AGENT_WORKSPACES_STORAGE_KEY)
    if (raw) {
      const p = JSON.parse(raw) as Partial<WorkspacesState>
      if (Array.isArray(p.workspaces) && p.workspaces.length) {
        const workspaces = p.workspaces.map(migrate).map(materializeWorkspaceApiKey)
        const activeId =
          p.activeId && workspaces.some((w) => w.id === p.activeId) ? p.activeId : workspaces[0].id
        return { workspaces, activeId }
      }
    }
  } catch {
    /* 损坏数据 → 落到默认 */
  }
  const def = defaultWorkspace()
  return { workspaces: [def], activeId: def.id }
}

/** 惰性初始化 (首次读取时从 localStorage 装载; 之后内存权威)。 */
function ensure(): WorkspacesState {
  if (!state) state = load()
  return state
}

function persist(s: WorkspacesState) {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(AGENT_WORKSPACES_STORAGE_KEY, JSON.stringify(publicState(s)))
  } catch {
    /* 隐私模式 / 配额满 → 放弃持久化 */
  }
}

function commit(next: WorkspacesState) {
  state = next
  persist(next)
  for (const l of listeners) l()
}

// —— 订阅 / 快照 (供组件 useSyncExternalStore) ——

export function subscribeWorkspaces(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** 客户端快照 (引用稳定: 仅 commit 时变)。 */
export function getWorkspacesState(): WorkspacesState {
  return ensure()
}

/** 服务端 / 首帧快照 (稳定空集, 避免 SSR 读 localStorage)。 */
export function getServerWorkspacesState(): WorkspacesState {
  return SERVER_STATE
}

// —— 读取 ——

export function getActiveWorkspace(): AgentWorkspace | null {
  const s = ensure()
  return s.workspaces.find((w) => w.id === s.activeId) ?? s.workspaces[0] ?? null
}

export function getWorkspace(id: string): AgentWorkspace | undefined {
  return ensure().workspaces.find((w) => w.id === id)
}

// —— 变更 ——

/** 写回一个工作区 (存在则替换, 否则追加); 刷新 updatedAt。 */
export function saveWorkspace(ws: AgentWorkspace) {
  const s = ensure()
  const updated = { ...ws, updatedAt: Date.now() }
  persistWorkspaceApiKey(updated)
  const workspaces = s.workspaces.some((w) => w.id === ws.id)
    ? s.workspaces.map((w) => (w.id === ws.id ? updated : w))
    : [...s.workspaces, updated]
  commit({ ...s, workspaces })
}

export function createWorkspace(name?: string): AgentWorkspace {
  const s = ensure()
  const ws = defaultWorkspace(name ?? `工作区 ${s.workspaces.length + 1}`)
  commit({ workspaces: [...s.workspaces, ws], activeId: ws.id })
  return ws
}

export function deleteWorkspace(id: string) {
  workspaceApiKeyCache.delete(id)
  void secureDelete(workspaceApiKeySecureKey(id))
  const s = ensure()
  const workspaces = s.workspaces.filter((w) => w.id !== id)
  if (!workspaces.length) {
    const def = defaultWorkspace()
    commit({ workspaces: [def], activeId: def.id })
    return
  }
  const activeId = s.activeId === id ? workspaces[0].id : s.activeId
  commit({ workspaces, activeId })
}

export function renameWorkspace(id: string, name: string) {
  const ws = getWorkspace(id)
  if (ws) saveWorkspace({ ...ws, name: name.trim() || ws.name })
}

export function setActiveWorkspace(id: string): void {
  const s = ensure()
  if (s.activeId === id || !s.workspaces.some((w) => w.id === id)) return
  commit({ ...s, activeId: id })
}

// —— 派生 (供 panel / composer / precise-mode) ——

/** 解析本工作区实际使用的模型连接 (全局 或 覆盖)。 */
export function resolveModel(ws: AgentWorkspace): {
  baseURL: string
  model: string
  apiKey: string
} {
  if (ws.model.useGlobal) {
    const g = getAgentSettings()
    return { baseURL: g.baseURL, model: g.model, apiKey: g.apiKey }
  }
  return {
    baseURL: ws.model.baseURL,
    model: ws.model.model,
    apiKey:
      ws.model.apiKey ||
      workspaceApiKeyCache.get(ws.id) ||
      secureFallbackGet(workspaceApiKeySecureKey(ws.id)) ||
      "",
  }
}

export async function hydrateAgentWorkspaceSecretsSecure(): Promise<void> {
  if (secureHydrated) return
  if (secureHydrating) return secureHydrating
  secureHydrating = (async () => {
    const s = ensure()
    const workspaces = await Promise.all(
      s.workspaces.map(async (ws) => {
        const secureValue = await secureGet(workspaceApiKeySecureKey(ws.id))
        if (secureValue) workspaceApiKeyCache.set(ws.id, secureValue)
        else if (!isTauri() && ws.model.apiKey) {
          workspaceApiKeyCache.set(ws.id, ws.model.apiKey)
          await secureSet(workspaceApiKeySecureKey(ws.id), ws.model.apiKey)
        }
        return {
          ...ws,
          model: {
            ...ws.model,
            apiKey: workspaceApiKeyCache.get(ws.id) ?? "",
          },
        }
      }),
    )
    state = { ...s, workspaces }
    persist(state)
    secureHydrated = true
    for (const l of listeners) l()
  })().finally(() => {
    secureHydrating = null
  })
  return secureHydrating
}

export function agentWorkspacesSecuritySnapshot(): {
  total: number
  localApiKeyCount: number
  secureCachedCount: number
  secureHydrated: boolean
} {
  let localApiKeyCount = 0
  try {
    const raw =
      typeof localStorage === "undefined"
        ? null
        : localStorage.getItem(AGENT_WORKSPACES_STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as Partial<WorkspacesState>) : null
    const workspaces = Array.isArray(parsed?.workspaces) ? parsed.workspaces : []
    localApiKeyCount = workspaces.filter(
      (workspace) => typeof workspace?.model?.apiKey === "string" && workspace.model.apiKey.trim(),
    ).length
  } catch {
    localApiKeyCount = 0
  }
  return {
    total: ensure().workspaces.length,
    localApiKeyCount,
    secureCachedCount: workspaceApiKeyCache.size,
    secureHydrated,
  }
}

/** 模型是否可用 (有 baseURL/model/key)。 */
export function isWorkspaceConfigured(ws: AgentWorkspace): boolean {
  const m = resolveModel(ws)
  return Boolean(m.apiKey.trim() && m.baseURL.trim() && m.model.trim())
}

/** 本工作区进上下文的「我的」类目选择; includeHome=false → undefined (panel 据此不带 home)。 */
export function homeSelectionOf(ws: AgentWorkspace): HomeSelection | undefined {
  return ws.data.includeHome ? ws.data.home : undefined
}

/** 解析本工作区生效的规则正文 (全局规则 + 本工作区引用的规则; 见 agent-rules.activeRulesText)。 */
export function workspaceRulesText(ws: AgentWorkspace): string {
  return activeRulesText(ws.rules.ruleIds)
}
