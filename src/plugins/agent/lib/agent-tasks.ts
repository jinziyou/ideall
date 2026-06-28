// 任务注册表 (按工作空间分组) —— 一个任务 = 一段在某工作空间里进行的对话/运行。
// 对话正文复用 core 线程 (IndexedDB, 经 agent-store/FilesPort); 任务记录只存「归属工作空间 + 状态」的轻元数据,
// 不改 core/protocol 的 Thread 结构 (ideall 自包含约束)。task.id === thread.id (1:1)。
// 本地优先 localStorage。列表展示时与线程 join 取标题/时间/消息数。

import { createCollection } from "./agent-collection"
import { createThread, deleteThread } from "./agent-store"

export type TaskStatus = "active" | "running" | "done" | "failed"

export const TASK_STATUS_META: Record<TaskStatus, { label: string; dot: string }> = {
  active: { label: "进行中", dot: "bg-muted-foreground/60" },
  running: { label: "运行中", dot: "bg-warning" },
  done: { label: "已完成", dot: "bg-success" },
  failed: { label: "失败", dot: "bg-destructive" },
}

export interface AgentTask {
  /** = 对应 core 线程 id (1:1)。 */
  id: string
  workspaceId: string
  status: TaskStatus
  /** 收藏: 保护不被批量清理。 */
  starred: boolean
  createdAt: number
  updatedAt: number
}

function migrate(raw: Partial<AgentTask>): AgentTask {
  const now = Date.now()
  return {
    id: raw.id ?? "",
    workspaceId: raw.workspaceId ?? "",
    status: raw.status ?? "active",
    starred: raw.starred ?? false,
    createdAt: raw.createdAt ?? now,
    updatedAt: raw.updatedAt ?? now,
  }
}

const store = createCollection<AgentTask>("ideall:agent:tasks:v1", () => [], migrate)

export const subscribeTasks = store.subscribe
export const getTasks = store.get
export const getServerTasks = store.getServer
export const getTask = store.byId

/** 某工作空间的任务 (新→旧)。 */
export function listTasks(workspaceId: string): AgentTask[] {
  return store
    .get()
    .filter((t) => t.workspaceId === workspaceId)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

// 写侧 CRUD (createTask/setTaskStatus/setTaskStarred/deleteTask) + TASK_STATUS_META: 供任务管理 UI;
// 当前 ai-tasks 视图仅消费读侧 (attach/get/subscribe), 写侧待接管理操作。
/** 新建任务: 先建 core 线程, 再落任务记录 (id 对齐线程)。 */
export async function createTask(workspaceId: string): Promise<AgentTask> {
  const thread = await createThread()
  const now = Date.now()
  const task: AgentTask = {
    id: thread.id,
    workspaceId,
    status: "active",
    starred: false,
    createdAt: now,
    updatedAt: now,
  }
  store.upsert(task)
  return task
}

/** 把一个已存在的 core 线程登记为某工作空间的任务 (幂等; AgentPanel 首次发消息建线程后回调)。 */
export function attachTask(workspaceId: string, threadId: string): void {
  if (store.byId(threadId)) {
    touchTask(threadId)
    return
  }
  const now = Date.now()
  store.upsert({
    id: threadId,
    workspaceId,
    status: "active",
    starred: false,
    createdAt: now,
    updatedAt: now,
  })
}

export function touchTask(id: string): void {
  const t = store.byId(id)
  if (t) store.upsert({ ...t, updatedAt: Date.now() })
}

export function setTaskStatus(id: string, status: TaskStatus): void {
  const t = store.byId(id)
  if (t) store.upsert({ ...t, status, updatedAt: Date.now() })
}

export function setTaskStarred(id: string, starred: boolean): void {
  const t = store.byId(id)
  if (t) store.upsert({ ...t, starred, updatedAt: Date.now() })
}

/** 删除任务 (连同其 core 线程)。 */
export async function deleteTask(id: string): Promise<void> {
  store.remove(id)
  try {
    await deleteThread(id)
  } catch {
    /* 线程已不在 → 忽略 */
  }
}
