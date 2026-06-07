// AI 助手对话的本地存储仓库 —— 基于 IndexedDB (`agentThreads` 仓库)。
// 本地优先: 对话线程与消息只存本机浏览器, 不上传服务器。
import { AgentMessage, AgentRole, AgentThread } from "./model"
import { idbDelete, idbGet, idbGetAll, idbPut, STORE_AGENT_THREADS } from "@/lib/idb"

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

/** 线程列表, 按最近更新倒序。 */
export async function listThreads(): Promise<AgentThread[]> {
  const items = await idbGetAll<AgentThread>(STORE_AGENT_THREADS)
  return items.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getThread(id: string): Promise<AgentThread | undefined> {
  return idbGet<AgentThread>(STORE_AGENT_THREADS, id)
}

/** 新建空线程并落库。 */
export async function createThread(): Promise<AgentThread> {
  const now = Date.now()
  const thread: AgentThread = {
    id: uid(),
    title: "新对话",
    messages: [],
    createdAt: now,
    updatedAt: now,
  }
  await idbPut(STORE_AGENT_THREADS, thread)
  return thread
}

/** 整体写回线程 (消息内联)。调用方在内存里改好 messages 后调用。 */
export async function saveThread(thread: AgentThread): Promise<void> {
  await idbPut(STORE_AGENT_THREADS, { ...thread, updatedAt: Date.now() })
}

export async function deleteThread(id: string): Promise<void> {
  await idbDelete(STORE_AGENT_THREADS, id)
}

export async function renameThread(id: string, title: string): Promise<void> {
  const t = await getThread(id)
  if (!t) return
  await saveThread({ ...t, title: title.trim() || t.title })
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
