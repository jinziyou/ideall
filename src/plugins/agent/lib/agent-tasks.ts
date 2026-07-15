// Agent 任务客户端缓存。任务关系与线程正文的耐久真值均由 FilesPort 背后的 IndexedDB 持有；
// 本模块只维护 useSyncExternalStore 所需的稳定同步快照。旧 localStorage key 仅作一次性迁移输入。

import {
  getFilesPort,
  type Thread,
  type ThreadTask,
  type ThreadTaskMutation,
} from "@protocol/files"
import { onFilesUpdated } from "@protocol/flowback"
import { AGENT_TASKS_FILE_REF } from "@/filesystem/builtin-app-roots"
import { withFileWriteLock } from "@/filesystem/write-lock"
import type { AgentThread } from "./model"
import { MAX_AGENT_TASK_ITEMS } from "../agent-management-file-contract"

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

export const AGENT_TASKS_STORAGE_KEY = "ideall:agent:tasks:v1"

const SERVER_TASKS: AgentTask[] = []
let tasksSnapshot: AgentTask[] = SERVER_TASKS
let taskById = new Map<string, AgentTask>()
let revision = 0
let ready = false
let hydration: Promise<void> | null = null
let synchronization: Promise<void> | null = null
let requestedSynchronization = 0
let completedSynchronization = 0
let fullRefreshRequested = false
const listeners = new Set<() => void>()
let stopFilesListener: (() => void) | null = null
let stopLifecycleListener: (() => void) | null = null

function validTime(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback
}

function normalizeTask(raw: Partial<AgentTask>, now: number): AgentTask {
  const createdAt = validTime(raw.createdAt, now)
  return {
    id: typeof raw.id === "string" ? raw.id.trim() : "",
    workspaceId: typeof raw.workspaceId === "string" ? raw.workspaceId.trim() : "",
    status:
      raw.status === "active" ||
      raw.status === "running" ||
      raw.status === "done" ||
      raw.status === "failed"
        ? raw.status
        : "active",
    starred: raw.starred === true,
    createdAt,
    updatedAt: validTime(raw.updatedAt, createdAt),
  }
}

function normalizeTasks(items: readonly Partial<AgentTask>[]): AgentTask[] {
  const now = Date.now()
  const byId = new Map<string, AgentTask>()
  for (const raw of items) {
    const task = normalizeTask(raw, now)
    if (!task.id || !task.workspaceId) continue
    const current = byId.get(task.id)
    if (!current || task.updatedAt > current.updatedAt) byId.set(task.id, task)
  }
  return [...byId.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
    .slice(0, MAX_AGENT_TASK_ITEMS)
}

function parseLegacyTasks(raw: string): AgentTask[] {
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    return normalizeTasks(
      value.filter(
        (item): item is Partial<AgentTask> =>
          item !== null && typeof item === "object" && !Array.isArray(item),
      ),
    )
  } catch {
    return []
  }
}

function legacyStorage(): Storage | undefined {
  try {
    return typeof globalThis.localStorage === "undefined" ? undefined : globalThis.localStorage
  } catch {
    return undefined
  }
}

function sameTasks(left: readonly AgentTask[], right: readonly AgentTask[]): boolean {
  if (left.length !== right.length) return false
  return left.every((task, index) => {
    const other = right[index]
    return (
      other !== undefined &&
      task.id === other.id &&
      task.workspaceId === other.workspaceId &&
      task.status === other.status &&
      task.starred === other.starred &&
      task.createdAt === other.createdAt &&
      task.updatedAt === other.updatedAt
    )
  })
}

function publish(nextRevision: number, tasks: readonly Partial<AgentTask>[]): void {
  if (ready && nextRevision < revision) return
  const next = normalizeTasks(tasks)
  const changed = !sameTasks(tasksSnapshot, next)
  // 同一 revision 必须恒等于同一快照；相同序号的迟到/异常响应不能覆盖 last-good 状态。
  if (ready && nextRevision === revision && changed) return
  revision = Math.max(revision, nextRevision)
  ready = true
  if (!changed) return
  tasksSnapshot = next
  taskById = new Map(next.map((task) => [task.id, task]))
  for (const listener of listeners) listener()
}

async function reconcileMutation(id: string, mutation: ThreadTaskMutation): Promise<void> {
  if (mutation.revision <= revision) return
  if (mutation.revision === revision + 1) {
    const next = tasksSnapshot.filter((task) => task.id !== id)
    if (mutation.task) next.push(mutation.task)
    publish(mutation.revision, next)
    return
  }

  // revision 跳跃表示其间还有其它窗口提交，不能把单行响应拼到陈旧快照后再冒充完整状态。
  // 统一进入带尾读的同步循环，保证正在进行的旧读取不会吞掉本次提交。
  await refreshTasksRaw()
}

function toAgentThread(thread: Thread): AgentThread {
  return { ...thread, messages: thread.messages as AgentThread["messages"] }
}

/**
 * 无 FileRef 锁的首次水合原语。浏览器环境下可能把旧 localStorage 快照
 * 幂等迁移到 IDB；只能在调用方已持有 config:tasks 锁时直接使用。
 */
export function ensureTasksReadyRaw(): Promise<void> {
  if (ready) return Promise.resolve()
  if (hydration) return hydration

  hydration = (async () => {
    const storage = legacyStorage()
    if (!storage) {
      const current = await getFilesPort().listThreadTasks()
      publish(current.revision, current.tasks)
      return
    }

    let raw: string | null
    try {
      raw = storage.getItem(AGENT_TASKS_STORAGE_KEY)
    } catch {
      const current = await getFilesPort().listThreadTasks()
      publish(current.revision, current.tasks)
      return
    }

    const migrated = await getFilesPort().migrateLegacyThreadTasks(
      raw === null ? [] : parseLegacyTasks(raw),
    )
    publish(migrated.revision, migrated.tasks)
    if (raw !== null) {
      try {
        storage.removeItem(AGENT_TASKS_STORAGE_KEY)
      } catch {
        // IDB 事务已经提交；遗留 key 删除失败不应把真值回退到 localStorage。
      }
    }
  })().finally(() => {
    hydration = null
  })
  return hydration
}

/** 公开水合入口；可能发生的 legacy migration 与所有 task writer 共用锁。 */
export function ensureTasksReady(): Promise<void> {
  return withFileWriteLock(AGENT_TASKS_FILE_REF, ensureTasksReadyRaw)
}

/**
 * 合并同步请求，但不吞掉读取期间到达的失效信号：每轮记住开始时的 epoch，若 await
 * 期间 epoch 前进，完成当前读取后必定再做一轮尾校验。普通失效先 O(1) 读耐久索引头，
 * 只有 revision/count 变化才加载完整任务快照。
 */
function synchronizeTasksRaw(forceFull: boolean): Promise<void> {
  requestedSynchronization += 1
  fullRefreshRequested ||= forceFull
  if (synchronization) return synchronization

  synchronization = (async () => {
    while (completedSynchronization < requestedSynchronization) {
      const target = requestedSynchronization
      const requireFull = fullRefreshRequested
      fullRefreshRequested = false
      try {
        if (!ready) {
          await ensureTasksReadyRaw()
        } else if (requireFull) {
          const current = await getFilesPort().listThreadTasks()
          publish(current.revision, current.tasks)
        } else {
          const head = await getFilesPort().readThreadTaskIndexHead()
          if (head.revision !== revision || head.count !== tasksSnapshot.length) {
            const current = await getFilesPort().listThreadTasks()
            publish(current.revision, current.tasks)
          }
        }
        completedSynchronization = target
      } catch (error) {
        fullRefreshRequested ||= requireFull
        throw error
      }
    }
  })().finally(() => {
    synchronization = null
  })
  return synchronization
}

/** 强制从 IDB 重读；并发请求共享循环，期间的新请求会触发尾读。 */
export function refreshTasksRaw(): Promise<void> {
  return synchronizeTasksRaw(true)
}

/** 锁外调用方使用的强制重读入口。 */
export function refreshTasks(): Promise<void> {
  return withFileWriteLock(AGENT_TASKS_FILE_REF, refreshTasksRaw)
}

export function revalidateTasksRaw(): Promise<void> {
  return synchronizeTasksRaw(false)
}

function revalidateTasks(): Promise<void> {
  return withFileWriteLock(AGENT_TASKS_FILE_REF, revalidateTasksRaw)
}

function onTaskLifecycleResume(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {}
  const target = window
  const resume = () => callback()
  target.addEventListener("pageshow", resume)
  target.addEventListener("focus", resume)

  let documentTarget: Document | null = null
  const resumeWhenVisible = () => {
    if (documentTarget?.visibilityState === "visible") callback()
  }
  try {
    documentTarget = target.document ?? null
    documentTarget?.addEventListener("visibilitychange", resumeWhenVisible)
  } catch {
    documentTarget = null
  }

  return () => {
    target.removeEventListener("pageshow", resume)
    target.removeEventListener("focus", resume)
    documentTarget?.removeEventListener("visibilitychange", resumeWhenVisible)
  }
}

export function subscribeTasks(listener: () => void): () => void {
  listeners.add(listener)
  if (!stopFilesListener) {
    stopFilesListener = onFilesUpdated((detail) => {
      if (detail?.kind === "thread") void revalidateTasks().catch(() => {})
    })
    stopLifecycleListener = onTaskLifecycleResume(() => {
      void revalidateTasks().catch(() => {})
    })
    void revalidateTasks().catch(() => {})
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      stopFilesListener?.()
      stopFilesListener = null
      stopLifecycleListener?.()
      stopLifecycleListener = null
    }
  }
}

export function getTasks(): AgentTask[] {
  return tasksSnapshot
}

export function getServerTasks(): AgentTask[] {
  return SERVER_TASKS
}

export function getTask(id: string): AgentTask | undefined {
  return taskById.get(id)
}

/** 某工作空间的任务 (新→旧)。 */
export function listTasks(workspaceId: string): AgentTask[] {
  return tasksSnapshot.filter((task) => task.workspaceId === workspaceId)
}

/**
 * 无 FileRef 锁的 store 级原语。runtime 入口必须经 agent-task-write-adapter；
 * provider/importer 在已持有 config:tasks 锁时可直接调用 Raw 原语。
 */
export async function createTaskThreadRaw(workspaceId: string): Promise<AgentThread> {
  await ensureTasksReadyRaw()
  const created = await getFilesPort().createTaskThread(workspaceId)
  await reconcileMutation(created.task.id, { revision: created.revision, task: created.task })
  return toAgentThread(created.thread)
}

/** 无 FileRef 锁的新建任务原语。 */
export async function createTaskRaw(workspaceId: string): Promise<AgentTask> {
  const thread = await createTaskThreadRaw(workspaceId)
  const task = taskById.get(thread.id)
  if (!task) throw new Error("任务创建成功但客户端快照缺少对应记录")
  return task
}

/** 把已存在的 core 线程登记为任务；Storage 层负责幂等与引用校验。 */
export async function attachTaskRaw(workspaceId: string, threadId: string): Promise<void> {
  await ensureTasksReadyRaw()
  const mutation = await getFilesPort().attachThreadTask(workspaceId, threadId)
  await reconcileMutation(threadId, mutation)
}

export async function touchTaskRaw(id: string): Promise<void> {
  await ensureTasksReadyRaw()
  if (!taskById.has(id)) return
  const mutation = await getFilesPort().updateThreadTask(id, { touch: true })
  await reconcileMutation(id, mutation)
}

export async function setTaskStatusRaw(id: string, status: TaskStatus): Promise<void> {
  await ensureTasksReadyRaw()
  if (!taskById.has(id)) return
  const mutation = await getFilesPort().updateThreadTask(id, { status })
  await reconcileMutation(id, mutation)
}

export async function setTaskStarredRaw(id: string, starred: boolean): Promise<void> {
  await ensureTasksReadyRaw()
  if (!taskById.has(id)) return
  const mutation = await getFilesPort().updateThreadTask(id, { starred })
  await reconcileMutation(id, mutation)
}

/** 原子移除任务关系并软删除对应 core 线程；失败时不发布局部快照。 */
export async function deleteTaskRaw(id: string): Promise<void> {
  await ensureTasksReadyRaw()
  const mutation = await getFilesPort().deleteTaskThread(id)
  await reconcileMutation(id, mutation)
}

/** 全局会话面板删除也统一走原子入口，Storage 会处理没有 task 的普通线程。 */
export async function deleteTaskOrThreadRaw(id: string): Promise<void> {
  await ensureTasksReadyRaw()
  const mutation = await getFilesPort().deleteTaskThread(id)
  await reconcileMutation(id, mutation)
}

/** 以当前快照 revision 做 CAS，原子替换任务索引；失败时保留原快照。 */
export async function replaceTasksRaw(tasks: readonly Partial<AgentTask>[]): Promise<void> {
  await ensureTasksReadyRaw()
  if (tasks.length > MAX_AGENT_TASK_ITEMS) {
    throw new Error(`Agent 任务不能超过 ${MAX_AGENT_TASK_ITEMS} 项`)
  }
  const next = normalizeTasks(tasks)
  const expectedRevision = revision
  const result = await getFilesPort().replaceThreadTasks(next as ThreadTask[], expectedRevision)
  publish(result.revision, result.tasks)
}
