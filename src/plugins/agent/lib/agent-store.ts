// AI 助手对话的存储外观 (agent 插件) —— 折叠步 D 后线程归 core 拥有 (nodes 仓库 kind:"thread"),
// 本模块改经 @protocol/files 的 FilesPort 消费 (依赖反转: 插件不直接碰 IndexedDB / core 存储)。
// 消息语义 (AgentMessage) 属本插件域; 端口以 Thread.messages: unknown[] 透传, 本边界断言为 AgentMessage[]。
import { getFilesPort } from "@protocol/files"
import type { Thread } from "@protocol/files"
import { AgentMessage, AgentRole, AgentThread } from "./model"

function uid(): string {
  // crypto.randomUUID 仅安全上下文 (localhost / https) 可用; 非安全 HTTP 下退化为时间戳+随机。
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID()
    }
  } catch {
    /* 落到下面的退化方案 */
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** 端口 Thread (messages: unknown[]) → 插件 AgentThread (断言 messages 为 AgentMessage[])。 */
function toAgentThread(t: Thread): AgentThread {
  return { ...t, messages: t.messages as AgentMessage[] }
}

/** 线程列表, 按最近更新倒序 (排序在 core threads-store 内完成)。 */
export async function listThreads(): Promise<AgentThread[]> {
  return (await getFilesPort().listThreads()).map(toAgentThread)
}

export async function getThread(id: string): Promise<AgentThread | undefined> {
  const t = await getFilesPort().getThread(id)
  return t ? toAgentThread(t) : undefined
}

/** 新建空线程并落库。 */
export async function createThread(): Promise<AgentThread> {
  return toAgentThread(await getFilesPort().createThread())
}

/** 整体写回线程 (消息内联)。调用方在内存里改好 messages 后调用。 */
export async function saveThread(thread: AgentThread): Promise<void> {
  // AgentThread 结构上满足 Thread (AgentMessage[] 可赋给 unknown[]); updatedAt 由 core 刷新。
  await getFilesPort().saveThread(thread)
}

export async function deleteThread(id: string): Promise<void> {
  await getFilesPort().deleteThread(id)
}

export async function renameThread(id: string, title: string): Promise<void> {
  await getFilesPort().renameThread(id, title)
}

/** 构造一条消息 (供调用方追加到线程的 messages)。 */
export function makeMessage(role: AgentRole, content: string): AgentMessage {
  return { id: uid(), role, content, createdAt: Date.now() }
}

/** 由首条用户消息推断线程标题 (截断)。 */
export function titleFromMessage(content: string): string {
  const t = content.trim().replace(/\s+/g, " ")
  return t.length > 24 ? t.slice(0, 24) + "…" : t || "新对话"
}
