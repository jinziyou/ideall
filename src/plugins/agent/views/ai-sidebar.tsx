"use client"

// 「AI」二级侧栏 (activeModule==="agent" 时由 secondary-sidebar 渲染并注入高亮状态)。
// 四区段 (上→下): MCP · Skills · 规则 · 工作空间。
//   MCP/Skills/规则 = 点开各自管理标签 (内部 list+detail)。
//   工作空间 = 可就地展开露「数据/能力/规则」; 点名字 → 开该空间的任务标签。
// 触达工作区只准经 @/lib/ui-actions 端口 (守 plugin↛app 边界); 高亮状态由外壳以 props 注入。

import * as React from "react"
import { Boxes, ChevronRight, Plug, Plus, ScrollText, Settings2, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { getUiActions } from "@/lib/ui-actions"
import { CountBadge, StatusDot } from "./ui-kit"
import { capabilityLabel } from "../lib/agent-capabilities"
import {
  createWorkspace,
  getServerWorkspacesState,
  getWorkspacesState,
  isWorkspaceConfigured,
  subscribeWorkspaces,
  type AgentWorkspace,
} from "../lib/agent-workspace"
import { getMcpServers, getServerMcpServers, subscribeMcpServers } from "../lib/agent-mcp-registry"
import { getServerSkills, getSkills, subscribeSkills } from "../lib/agent-skills"
import { getRules, getServerRules, subscribeRules } from "../lib/agent-rules"

const DATA_LABELS: Record<string, string> = {
  notes: "笔记",
  subscriptions: "关注",
  bookmarks: "书签",
  folders: "收藏夹",
  files: "资源",
}

export default function AiSidebar({
  activeKind,
  activeWorkspaceId,
}: {
  activeKind: string | null
  activeWorkspaceId: string | null
}) {
  const wsState = React.useSyncExternalStore(
    subscribeWorkspaces,
    getWorkspacesState,
    getServerWorkspacesState,
  )
  const mcp = React.useSyncExternalStore(subscribeMcpServers, getMcpServers, getServerMcpServers)
  const skills = React.useSyncExternalStore(subscribeSkills, getSkills, getServerSkills)
  const rules = React.useSyncExternalStore(subscribeRules, getRules, getServerRules)

  const ui = getUiActions()

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-4">
      <SectionLink
        icon={Plug}
        label="MCP"
        count={mcp.length}
        active={activeKind === "ai-mcp"}
        onOpen={() => ui?.openAiSection?.("ai-mcp")}
      />
      <SectionLink
        icon={Sparkles}
        label="Skills"
        count={skills.length}
        active={activeKind === "ai-skills"}
        onOpen={() => ui?.openAiSection?.("ai-skills")}
      />
      <SectionLink
        icon={ScrollText}
        label="规则"
        count={rules.length}
        active={activeKind === "ai-rules"}
        onOpen={() => ui?.openAiSection?.("ai-rules")}
      />

      {/* 工作空间分组 */}
      <div className="mt-6">
        <div className="flex items-center gap-2 px-1 pb-2">
          <Boxes className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="flex-1 text-xs font-medium text-muted-foreground">工作区</span>
          <button
            type="button"
            title="新建工作区"
            onClick={() => {
              const ws = createWorkspace()
              ui?.openAiTasks?.(ws.id, ws.name)
            }}
            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="sr-only">新建工作区</span>
          </button>
        </div>
        <div className="space-y-0.5">
          {wsState.workspaces.map((ws) => (
            <WorkspaceRow
              key={ws.id}
              ws={ws}
              active={activeWorkspaceId === ws.id}
              onOpen={() => ui?.openAiTasks?.(ws.id, ws.name)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function SectionLink({
  icon: Icon,
  label,
  count,
  active,
  onOpen,
}: {
  icon: typeof Plug
  label: string
  count: number
  active: boolean
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition-colors",
        active
          ? "bg-accent font-medium text-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="flex-1 text-left">{label}</span>
      {count > 0 && <CountBadge>{count}</CountBadge>}
    </button>
  )
}

function WorkspaceRow({
  ws,
  active,
  onOpen,
}: {
  ws: AgentWorkspace
  active: boolean
  onOpen: () => void
}) {
  const [open, setOpen] = React.useState(false)
  const configured = isWorkspaceConfigured(ws)

  const dataSummary = ws.data.includeHome
    ? Object.entries(ws.data.home)
        .filter(([, v]) => v)
        .map(([k]) => DATA_LABELS[k] ?? k)
        .join(" · ") || "我的"
    : "未带「我的」"
  const caps = ws.capabilities.permissions.map(capabilityLabel)
  const skillCount =
    ws.capabilities.skillIds === null ? "全部" : `${ws.capabilities.skillIds.length} 个`

  return (
    <div>
      <div
        className={cn(
          "group flex items-center gap-1 rounded-lg pr-1 transition-colors",
          active ? "bg-accent text-foreground" : "hover:bg-accent/50",
        )}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex h-7 w-6 shrink-0 items-center justify-center text-muted-foreground"
          aria-label={open ? "收起" : "展开"}
        >
          <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-90")} />
        </button>
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left text-sm"
          title={ws.name}
        >
          <StatusDot tone={configured ? "ok" : "idle"} />
          <span className={cn("flex-1 truncate", active ? "font-medium" : undefined)}>
            {ws.name}
          </span>
        </button>
        <button
          type="button"
          title="配置工作区"
          onClick={onOpen}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
        >
          <Settings2 className="h-3.5 w-3.5" />
          <span className="sr-only">配置工作区</span>
        </button>
      </div>
      {open && (
        <div className="ml-6 space-y-1 border-l py-1 pl-3 text-[12px] text-muted-foreground">
          <SubMeta label="数据" value={dataSummary} />
          <SubMeta
            label="能力"
            value={caps.length ? `${caps.join(" · ")} · 技能 ${skillCount}` : `技能 ${skillCount}`}
          />
          <SubMeta
            label="规则"
            value={ws.rules.ruleIds.length ? `引用 ${ws.rules.ruleIds.length} 条 + 全局` : "仅全局"}
          />
        </div>
      )}
    </div>
  )
}

function SubMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="w-7 shrink-0 text-[11px] text-muted-foreground/70">{label}</span>
      <span className="min-w-0 flex-1 break-words">{value}</span>
    </div>
  )
}
