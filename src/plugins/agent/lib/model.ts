// AI 智能体 (agent) 插件域类型 —— 对话线程 / 消息 / 工具事件。
// 本地优先: 线程存于浏览器 IndexedDB 的 agentThreads 仓库 (消息内联于线程文档)。

/** AI 智能体消息角色 (与 OpenAI 兼容接口一致) */
export type AgentRole = "system" | "user" | "assistant"

/** 智能体一次工具调用的展示记录 (仅前端展示与存档, 不回传给模型) */
export interface AgentToolEvent {
  /** 工具名 (如 add_bookmark) */
  name: string
  /** 入参的简短文本 */
  argsText: string
  /** 是否成功 */
  ok: boolean
  /** 结果摘要 (供用户查看做了什么) */
  summary: string
}

/** 一条对话消息 */
export interface AgentMessage {
  id: string
  role: AgentRole
  content: string
  createdAt: number
  /** 智能体模式下该条消息执行过的工具调用 (展示用, 不回传模型) */
  toolEvents?: AgentToolEvent[]
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
