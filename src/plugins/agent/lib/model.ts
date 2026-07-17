// AI 智能体 (agent) 插件域类型 —— 对话线程 / 消息 / 工具事件。
// 本地优先: 线程存于浏览器 IndexedDB 的 agentThreads 仓库 (消息内联于线程文档)。
import type { AgentContextSource } from "@/lib/agent-context-tray"

/** AI 智能体消息角色 (与 OpenAI 兼容接口一致) */
export type AgentRole = "system" | "user" | "assistant"

/** 智能体一次工具调用的展示记录 (仅前端展示与存档, 不回传给模型) */
export interface AgentToolEvent {
  /** 工具名 (如 add_bookmark) */
  name: string
  /** 脱敏预览摘要；不得持久化原始入参。 */
  argsText: string
  /** 是否成功 */
  ok: boolean
  /** 结果摘要 (供用户查看做了什么) */
  summary: string
}

type AgentArtifactReceiptBase = {
  nodeId: string
  title: string
  createdAt: number
  /** 本次产物记录的原始上下文引用，用于审计资料派生关系。 */
  sourceKeys: readonly string[]
  /** 撤销成功后的本机时间；保留原回执作为审计记录。 */
  undoneAt?: number
}

/** 用户确认把一条 AI 回答落为本地资料后的轻量回执。 */
export type AgentArtifactReceipt = AgentArtifactReceiptBase &
  (
    | { kind: "note" }
    | {
        kind: "task"
        workspaceId: string
        workspaceName: string
        /** 创建后提交任务正文得到的 thread.updatedAt；安全撤销以它做事务内 CAS。 */
        committedVersion: number
      }
    | {
        kind: "bookmark-description"
        /** 预览时看到的旧描述；仅在 committedVersion 未变化时允许写回。 */
        previousDescription: string
        committedVersion: number
      }
  )

export function isAgentArtifactReceipt(value: unknown): value is AgentArtifactReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const receipt = value as Record<string, unknown>
  const common =
    (receipt.kind === "note" ||
      receipt.kind === "task" ||
      receipt.kind === "bookmark-description") &&
    typeof receipt.nodeId === "string" &&
    receipt.nodeId.length > 0 &&
    typeof receipt.title === "string" &&
    receipt.title.length <= 256 &&
    typeof receipt.createdAt === "number" &&
    Number.isSafeInteger(receipt.createdAt) &&
    receipt.createdAt >= 0 &&
    Array.isArray(receipt.sourceKeys) &&
    receipt.sourceKeys.length <= 8 &&
    receipt.sourceKeys.every(
      (key) => typeof key === "string" && key.length > 0 && key.length <= 9_216,
    ) &&
    (receipt.undoneAt === undefined ||
      (typeof receipt.undoneAt === "number" &&
        Number.isSafeInteger(receipt.undoneAt) &&
        receipt.undoneAt >= 0))
  if (!common) return false
  if (receipt.kind === "note") return true
  if (
    typeof receipt.committedVersion !== "number" ||
    !Number.isSafeInteger(receipt.committedVersion) ||
    receipt.committedVersion < 0
  ) {
    return false
  }
  if (receipt.kind === "task") {
    return (
      typeof receipt.workspaceId === "string" &&
      receipt.workspaceId.length > 0 &&
      receipt.workspaceId.length <= 256 &&
      typeof receipt.workspaceName === "string" &&
      receipt.workspaceName.length > 0 &&
      receipt.workspaceName.length <= 256
    )
  }
  return (
    typeof receipt.previousDescription === "string" && receipt.previousDescription.length <= 8_000
  )
}

export function isUndoableAgentArtifact(
  receipt: AgentArtifactReceipt,
): receipt is Extract<AgentArtifactReceipt, { kind: "task" | "bookmark-description" }> {
  return receipt.kind === "task" || receipt.kind === "bookmark-description"
}

/** 一条对话消息 */
export interface AgentMessage {
  id: string
  role: AgentRole
  content: string
  createdAt: number
  /** 智能体模式下该条消息执行过的工具调用 (展示用, 不回传模型) */
  toolEvents?: AgentToolEvent[]
  /** 本次回答实际注入的显式上下文来源；仅含引用与标题，不复制正文。 */
  sources?: readonly AgentContextSource[]
  /** 由用户确认落地的本地资料回执；用于从回答回到产物及审计写入结果。 */
  artifacts?: readonly AgentArtifactReceipt[]
}

/**
 * AI 智能体对话线程 —— 本地优先, 消息内联存于线程文档 (IndexedDB agentThreads 仓库)。
 * 对话内容只存本机浏览器; 发送时才把消息 + home 上下文直连发给模型厂商 (不经服务端代理; 见 agent-chat.ts)。
 */
export interface AgentThread {
  id: string
  /** 线程标题 (默认取首条用户消息, 可重命名) */
  title: string
  messages: AgentMessage[]
  createdAt: number
  updatedAt: number
}
