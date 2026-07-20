import type { FileRef } from "@protocol/file-system"
import { AGENT_TASKS_FILE_REF } from "@/filesystem/builtin-app-roots"
import { withFileWriteLock } from "@/filesystem/write-lock"
import {
  attachTaskRaw,
  createTaskRaw,
  createTaskThreadRaw,
  deleteTaskOrThreadRaw,
  deleteTaskRaw,
  refreshTasksRaw,
  replaceTasksRaw,
  setTaskStarredRaw,
  setTaskStatusRaw,
  touchTaskRaw,
  type AgentTask,
  type TaskStatus,
} from "./lib/agent-tasks"
import type { AgentThread } from "./lib/model"

type FileWriteLock = <T>(ref: FileRef, operation: () => T | Promise<T>) => Promise<T>

export type AgentTaskWriteAdapterDeps = Readonly<{
  refreshTasksRaw: typeof refreshTasksRaw
  createTaskThread: typeof createTaskThreadRaw
  createTask: typeof createTaskRaw
  attachTask: typeof attachTaskRaw
  touchTask: typeof touchTaskRaw
  setTaskStatus: typeof setTaskStatusRaw
  setTaskStarred: typeof setTaskStarredRaw
  deleteTask: typeof deleteTaskRaw
  deleteTaskOrThread: typeof deleteTaskOrThreadRaw
  replaceTasks: typeof replaceTasksRaw
}>

export type AgentTaskWriteAdapter = Readonly<{
  createTaskThread(workspaceId: string): Promise<AgentThread>
  createTask(workspaceId: string): Promise<AgentTask>
  attachTask(workspaceId: string, threadId: string): Promise<void>
  touchTask(id: string): Promise<void>
  setTaskStatus(id: string, status: TaskStatus): Promise<void>
  setTaskStarred(id: string, starred: boolean): Promise<void>
  deleteTask(id: string, expectedThreadUpdatedAt?: number): Promise<void>
  deleteTaskOrThread(id: string): Promise<void>
  replaceTasks(tasks: readonly Partial<AgentTask>[]): Promise<void>
}>

const defaultDeps: AgentTaskWriteAdapterDeps = {
  refreshTasksRaw,
  createTaskThread: createTaskThreadRaw,
  createTask: createTaskRaw,
  attachTask: attachTaskRaw,
  touchTask: touchTaskRaw,
  setTaskStatus: setTaskStatusRaw,
  setTaskStarred: setTaskStarredRaw,
  deleteTask: deleteTaskRaw,
  deleteTaskOrThread: deleteTaskOrThreadRaw,
  replaceTasks: replaceTasksRaw,
}

/** Agent task 的跨入口写屏障；workspaces provider 也按 tasks→workspaces 顺序取锁。 */
export function withAgentTasksFileWriteLock<T>(
  operation: () => T | Promise<T>,
  lock: FileWriteLock = withFileWriteLock,
): Promise<T> {
  return lock(AGENT_TASKS_FILE_REF, operation)
}

/**
 * runtime 变更在锁内先重读耐久 task revision，再调用无锁原语。
 * provider/importer 已持有同一 FileRef 锁，必须继续直接调用 Raw 原语而不进入本 adapter。
 */
export function createAgentTaskWriteAdapter(
  deps: AgentTaskWriteAdapterDeps = defaultDeps,
  lock: FileWriteLock = withFileWriteLock,
): AgentTaskWriteAdapter {
  function mutate<T>(operation: () => T | Promise<T>): Promise<T> {
    return withAgentTasksFileWriteLock(async () => {
      await deps.refreshTasksRaw()
      return operation()
    }, lock)
  }

  return Object.freeze({
    createTaskThread: (workspaceId) => mutate(() => deps.createTaskThread(workspaceId)),
    createTask: (workspaceId) => mutate(() => deps.createTask(workspaceId)),
    attachTask: (workspaceId, threadId) => mutate(() => deps.attachTask(workspaceId, threadId)),
    touchTask: (id) => mutate(() => deps.touchTask(id)),
    setTaskStatus: (id, status) => mutate(() => deps.setTaskStatus(id, status)),
    setTaskStarred: (id, starred) => mutate(() => deps.setTaskStarred(id, starred)),
    deleteTask: (id, expectedThreadUpdatedAt) =>
      mutate(() => deps.deleteTask(id, expectedThreadUpdatedAt)),
    deleteTaskOrThread: (id) => mutate(() => deps.deleteTaskOrThread(id)),
    replaceTasks: (tasks) => mutate(() => deps.replaceTasks(tasks)),
  })
}

const runtimeAgentTaskWriter = createAgentTaskWriteAdapter()

export const createTaskThread = runtimeAgentTaskWriter.createTaskThread
export const createTask = runtimeAgentTaskWriter.createTask
export const attachTask = runtimeAgentTaskWriter.attachTask
export const touchTask = runtimeAgentTaskWriter.touchTask
export const setTaskStatus = runtimeAgentTaskWriter.setTaskStatus
export const setTaskStarred = runtimeAgentTaskWriter.setTaskStarred
export const deleteTask = runtimeAgentTaskWriter.deleteTask
export const deleteTaskOrThread = runtimeAgentTaskWriter.deleteTaskOrThread
export const replaceTasks = runtimeAgentTaskWriter.replaceTasks
