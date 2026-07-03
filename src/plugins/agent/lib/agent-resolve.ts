// 工作空间运行解析 —— 把一个工作空间 (数据+能力+规则+提示词+模型) 解析为「一次运行」的连接 + 系统提示 + 能力收窄。
// 供任务标签的 AgentPanel 经 resolveRun 注入 (发送时调用, 取最新工作空间)。精确模式可原样覆盖。
// (前身为 ai-workspace.tsx 内联的 resolveRun; 抽到 lib 以便任务标签复用。)

import { toExternalServer, type ConnectAgentOpts } from "./agent-mcp"
import type { AgentWorkspace } from "./agent-workspace"
import { homeSelectionOf, resolveModel, workspaceRulesText } from "./agent-workspace"
import { getMcpServers, LOOPBACK_ID } from "./agent-mcp-registry"
import { resolveSkills } from "./agent-skills"
import {
  assembleSystemPrompt,
  buildWorkspaceSegments,
  gatherHomeContext,
  gatherReferencedContext,
  gatherBrowserContext,
} from "./agent-context"

/** 一次运行解析出的连接 + 已组装系统提示 + 能力收窄 (工作区 / 精确模式在此注入)。 */
export interface ResolvedRun {
  baseURL: string
  model: string
  apiKey: string
  /** 已组装好的系统提示 (工作区 / 精确模式在此给出最终文本)。 */
  system: string
  /** 工作区能力收窄 (传给 runAgent → connectAgentMcp)。 */
  mcp?: ConnectAgentOpts
}

/** 解析一个工作空间的本次运行 (未配置模型 → null, 调用方提示去设置)。 */
export async function resolveWorkspaceRun(
  ws: AgentWorkspace,
  useAgent: boolean,
): Promise<ResolvedRun | null> {
  const m = resolveModel(ws)
  if (!m.apiKey.trim() || !m.baseURL.trim() || !m.model.trim()) return null

  // MCP 注册表 → 本次运行的工具源: loopback 开关 + 启用的外部 server (sse/http/stdio)。
  const servers = getMcpServers()
  const loopback = servers.find((s) => s.id === LOOPBACK_ID)
  const externalServers = servers
    .filter(
      (s) =>
        s.enabled &&
        (((s.transport === "sse" || s.transport === "http") && s.url.trim()) ||
          (s.transport === "stdio" && s.command.trim())),
    )
    .map(toExternalServer)
  // 自动技能 (本工作区可用 + invocation:auto) → 合成工具供模型自调用。
  const autoSkills = resolveSkills(ws.capabilities.skillIds)
    .filter((s) => s.invocation === "auto")
    .map((s) => ({ id: s.id, name: s.label, description: s.hint, prompt: s.prompt }))

  const mcp: ConnectAgentOpts = {
    permissions: ws.capabilities.permissions,
    toolAllowlist: ws.capabilities.toolAllowlist,
    loopbackEnabled: loopback ? loopback.enabled : true,
    externalServers,
    autoSkills,
  }

  // 精确模式「原样发送」: 直接用用户编辑后的最终提示 (冻结快照, 不再取数)。
  if (ws.prompt.precise && ws.prompt.override.trim()) {
    return { ...m, system: ws.prompt.override, mcp }
  }

  const sel = homeSelectionOf(ws)
  let homeContext = ""
  let referenced = ""
  let browser = ""
  if (sel) {
    try {
      homeContext = await gatherHomeContext(sel)
    } catch {
      /* 取数失败时降级为空上下文 */
    }
    try {
      referenced = await gatherReferencedContext()
    } catch {
      /* 忽略 */
    }
    browser = gatherBrowserContext()
  }
  const system = assembleSystemPrompt(
    buildWorkspaceSegments({
      tools: useAgent,
      homeContext,
      referenced,
      browser,
      instructions: ws.prompt.instructions,
      rules: workspaceRulesText(ws),
      examples: "",
      // 可用技能 (auto): 普通对话感知 + 智能体模式合成「应用技能」(use_skill) 工具供模型按描述选用。
      skills: autoSkills.map((s) => ({ name: s.name, description: s.description })),
    }),
    ws.prompt.template,
  )
  return { ...m, system, mcp }
}
