// 外部 ACP 智能体对话的纯折叠逻辑 (客户端方向 UI 用) —— 把一轮里的 session/update 通知折叠成
// 可渲染的「助手消息」视图模型 (文本 + 工具事件)。纯函数、无 React/IO, 便于单测 (外部 agent 行为最易出错的一环)。
import type { AgentToolEvent } from "../model"
import type { PermissionOption, SessionUpdate, ToolCallStatus } from "@agentclientprotocol/sdk"

/** 一轮 (一次 prompt→stop) 的累积: 助手文本 + 工具调用 (按 toolCallId 跟踪状态)。 */
export interface AcpTurnState {
  text: string
  tools: { toolCallId: string; title: string; status: ToolCallStatus }[]
}

export const EMPTY_TURN: AcpTurnState = { text: "", tools: [] }

/** 折叠一条 session/update 进当前轮累积 (不可变; 未识别类型原样返回)。 */
export function foldAcpUpdate(turn: AcpTurnState, update: SessionUpdate): AcpTurnState {
  switch (update.sessionUpdate) {
    case "agent_message_chunk": {
      // 仅累积文本块 (图片/音频等 MVP 忽略)。
      return update.content.type === "text"
        ? { ...turn, text: turn.text + update.content.text }
        : turn
    }
    case "tool_call": {
      const tc = {
        toolCallId: update.toolCallId,
        title: update.title,
        status: update.status ?? ("pending" as ToolCallStatus),
      }
      const idx = turn.tools.findIndex((t) => t.toolCallId === tc.toolCallId)
      const tools = idx >= 0 ? turn.tools.map((t, i) => (i === idx ? tc : t)) : [...turn.tools, tc]
      return { ...turn, tools }
    }
    case "tool_call_update": {
      const tools = turn.tools.map((t) =>
        t.toolCallId === update.toolCallId
          ? { ...t, status: update.status ?? t.status, title: update.title ?? t.title }
          : t,
      )
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

/** 把一轮累积的工具调用投影为 ChatMessage 可渲染的工具事件。 */
export function turnToolEvents(turn: AcpTurnState): AgentToolEvent[] {
  return turn.tools.map((t) => ({
    name: t.title,
    argsText: "",
    ok: t.status !== "failed",
    summary: STATUS_LABEL[t.status] ?? t.status,
  }))
}

/** 据用户是否允许, 选一个权限选项: allow → 优先 allow_once、否则任一 allow_*、再否则首项; deny → null。 */
export function pickPermissionOption(
  options: readonly PermissionOption[],
  allow: boolean,
): PermissionOption | null {
  if (!allow) return null
  return (
    options.find((o) => o.kind === "allow_once") ??
    options.find((o) => o.kind.startsWith("allow")) ??
    options[0] ??
    null
  )
}
