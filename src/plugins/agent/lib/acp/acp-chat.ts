// 外部 ACP 智能体对话的纯折叠逻辑 (客户端方向 UI 用) —— 把一轮里的 session/update 通知折叠成
// 可渲染的「智能体消息」视图模型 (文本 + 工具事件)。纯函数、无 React/IO, 便于单测 (外部 agent 行为最易出错的一环)。
import type { AgentToolEvent } from "../model"
import type { PermissionOption, SessionUpdate, ToolCallStatus } from "@agentclientprotocol/sdk"

/** 一轮 (一次 prompt→stop) 的累积: 智能体文本 + 工具调用 (按 toolCallId 跟踪状态)。 */
export interface AcpTurnState {
  text: string
  tools: { toolCallId: string; title: string; status: ToolCallStatus }[]
}

export const EMPTY_TURN: AcpTurnState = { text: "", tools: [] }

export const MAX_ACP_TEXT_LENGTH = 256 * 1024
export const MAX_ACP_TOOL_CALLS = 256

function bounded(value: string, maxLength: number, fallback: string): string {
  const normalized = value.replace(/[\u0000-\u001f\u007f]+/gu, " ").trim()
  if (!normalized) return fallback
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized
}

function toolCallId(value: string): string {
  return bounded(value, 256, "external-tool")
}

function toolTitle(value: string | null | undefined): string {
  return bounded(value ?? "", 160, "外部 Agent 工具")
}

/** 折叠一条 session/update 进当前轮累积 (不可变; 未识别类型原样返回)。 */
export function foldAcpUpdate(turn: AcpTurnState, update: SessionUpdate): AcpTurnState {
  switch (update.sessionUpdate) {
    case "agent_message_chunk": {
      // 仅累积文本块 (图片/音频等 MVP 忽略)。
      if (update.content.type !== "text" || turn.text.length >= MAX_ACP_TEXT_LENGTH) return turn
      const text = turn.text + update.content.text
      return {
        ...turn,
        text:
          text.length > MAX_ACP_TEXT_LENGTH ? `${text.slice(0, MAX_ACP_TEXT_LENGTH - 1)}…` : text,
      }
    }
    case "tool_call": {
      const tc = {
        toolCallId: toolCallId(update.toolCallId),
        title: toolTitle(update.title),
        status: update.status ?? ("pending" as ToolCallStatus),
      }
      const idx = turn.tools.findIndex((t) => t.toolCallId === tc.toolCallId)
      const tools =
        idx >= 0
          ? turn.tools.map((t, i) => (i === idx ? tc : t))
          : turn.tools.length < MAX_ACP_TOOL_CALLS
            ? [...turn.tools, tc]
            : turn.tools
      return { ...turn, tools }
    }
    case "tool_call_update": {
      const id = toolCallId(update.toolCallId)
      const index = turn.tools.findIndex((tool) => tool.toolCallId === id)
      const tools =
        index >= 0
          ? turn.tools.map((tool, toolIndex) =>
              toolIndex === index
                ? {
                    ...tool,
                    status: update.status ?? tool.status,
                    title: update.title == null ? tool.title : toolTitle(update.title),
                  }
                : tool,
            )
          : turn.tools.length < MAX_ACP_TOOL_CALLS
            ? [
                ...turn.tools,
                {
                  toolCallId: id,
                  title: toolTitle(update.title),
                  status: update.status ?? ("pending" as ToolCallStatus),
                },
              ]
            : turn.tools
      return { ...turn, tools }
    }
    default:
      // plan / thought / mode / 其它: MVP 不进对话视图。
      return turn
  }
}

const STATUS_LABEL: Record<ToolCallStatus, string> = {
  pending: "待执行",
  in_progress: "执行中",
  completed: "已完成",
  failed: "失败",
}

/** 把一轮累积的工具调用映射为 ChatMessage 可渲染的工具事件。 */
export function turnToolEvents(turn: AcpTurnState): AgentToolEvent[] {
  return turn.tools.map((t) => ({
    name: t.title,
    argsText: "",
    ok: t.status !== "failed",
    summary: STATUS_LABEL[t.status] ?? t.status,
  }))
}

/** 据用户是否允许, 选一个权限选项: allow → 优先 allow_once、否则任一 allow_*；deny/无允许项 → null。 */
export function pickPermissionOption(
  options: readonly PermissionOption[],
  allow: boolean,
): PermissionOption | null {
  if (!allow) return null
  return (
    options.find((o) => o.kind === "allow_once") ??
    options.find((o) => o.kind.startsWith("allow")) ??
    null
  )
}
