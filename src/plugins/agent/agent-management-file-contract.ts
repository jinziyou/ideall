import type { FileRef } from "@protocol/file-system"

export const AGENT_WORKSPACE_CREATE_ACTION = "workspace.create"
export const AGENT_WORKSPACE_ACTIVATE_ACTION = "workspace.activate"
export const MAX_AGENT_WORKSPACE_ITEMS = 256
import { MAX_THREAD_TASK_ITEMS } from "@protocol/files"

export const MAX_AGENT_TASK_ITEMS = MAX_THREAD_TASK_ITEMS
export const MAX_AGENT_MANAGEMENT_STRING_LENGTH = 256
export const MAX_AGENT_TASK_FILE_ID_LENGTH = 4_096

export type AgentWorkspaceSummary = Readonly<{
  id: string
  name: string
  /** provider 从任务目录派生；不属于可写 workspace 配置。 */
  taskCount: number
}>

export type AgentWorkspacesDocument = Readonly<{
  workspaces: readonly AgentWorkspaceSummary[]
  activeId: string
}>

export type AgentTaskStatus = "active" | "running" | "done" | "failed"

export type AgentTaskSummary = Readonly<{
  id: string
  /** 任务所指向的对话文件；Display 不从 task id 猜测 provider 或文件编码。 */
  threadRef: FileRef
  workspaceId: string
  status: AgentTaskStatus
  updatedAt: number
}>

export type AgentWorkspaceCreateResult = Readonly<{
  workspaceId: string
  name: string
}>

export type AgentWorkspaceCreateInput = Readonly<{
  name?: string
}>

export type AgentWorkspaceActivateInput = Readonly<{
  workspaceId: string
}>

export type AgentWorkspaceActivateResult = Readonly<{
  workspaceId: string
}>

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}必须是对象`)
  }
  return value as Record<string, unknown>
}

function boundedString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label}必须是字符串`)
  if (value.length > MAX_AGENT_MANAGEMENT_STRING_LENGTH) {
    throw new Error(`${label}不能超过 ${MAX_AGENT_MANAGEMENT_STRING_LENGTH} 个字符`)
  }
  return value
}

function requiredString(value: unknown, label: string): string {
  const result = boundedString(value, label)
  if (!result.trim()) throw new Error(`${label}必须是非空字符串`)
  return result
}

function requiredFileId(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}必须是非空字符串`)
  if (value.length > MAX_AGENT_TASK_FILE_ID_LENGTH) {
    throw new Error(`${label}不能超过 ${MAX_AGENT_TASK_FILE_ID_LENGTH} 个字符`)
  }
  return value
}

function nonnegativeSafeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label}必须是非负安全整数`)
  }
  return value
}

function assertOnlyKeys(value: Record<string, unknown>, keys: readonly string[], label: string) {
  const extras = Object.keys(value).filter((key) => !keys.includes(key))
  if (extras.length > 0) throw new Error(`${label}包含未知字段: ${extras.join(", ")}`)
}

/** Display 只解码列表所需的公开字段，不依赖 backing store 的运行函数或私密模型字段。 */
export function decodeAgentWorkspacesDocument(value: unknown): AgentWorkspacesDocument {
  const source = record(value, "Agent 工作区文件")
  if (!Array.isArray(source.workspaces)) throw new Error("Agent 工作区文件.workspaces必须是数组")
  if (source.workspaces.length > MAX_AGENT_WORKSPACE_ITEMS) {
    throw new Error(`Agent 工作区文件不能超过 ${MAX_AGENT_WORKSPACE_ITEMS} 项`)
  }
  const seen = new Set<string>()
  const workspaces = source.workspaces.map((item, index) => {
    const workspace = record(item, `Agent 工作区文件.workspaces[${index}]`)
    const id = requiredString(workspace.id, `Agent 工作区文件.workspaces[${index}].id`)
    if (seen.has(id)) throw new Error(`Agent 工作区文件包含重复 id: ${id}`)
    seen.add(id)
    return {
      id,
      name: boundedString(workspace.name, `Agent 工作区文件.workspaces[${index}].name`),
      taskCount: nonnegativeSafeInteger(
        workspace.taskCount,
        `Agent 工作区文件.workspaces[${index}].taskCount`,
      ),
    }
  })
  const activeId = boundedString(source.activeId, "Agent 工作区文件.activeId")
  if (workspaces.length > 0 && !seen.has(activeId)) {
    throw new Error("Agent 工作区文件.activeId必须引用现有工作区")
  }
  if (workspaces.length === 0 && activeId) {
    throw new Error("空 Agent 工作区文件不能声明 activeId")
  }
  return { workspaces, activeId }
}

const TASK_STATUSES = new Set<AgentTaskStatus>(["active", "running", "done", "failed"])

export function decodeAgentTasksDocument(value: unknown): readonly AgentTaskSummary[] {
  if (!Array.isArray(value)) throw new Error("Agent 任务文件必须是数组")
  if (value.length > MAX_AGENT_TASK_ITEMS) {
    throw new Error(`Agent 任务文件不能超过 ${MAX_AGENT_TASK_ITEMS} 项`)
  }
  const seen = new Set<string>()
  return value.map((item, index) => {
    const task = record(item, `Agent 任务文件[${index}]`)
    const id = requiredString(task.id, `Agent 任务文件[${index}].id`)
    if (seen.has(id)) throw new Error(`Agent 任务文件包含重复 id: ${id}`)
    seen.add(id)
    if (typeof task.status !== "string" || !TASK_STATUSES.has(task.status as AgentTaskStatus)) {
      throw new Error(`Agent 任务文件[${index}].status无效`)
    }
    const updatedAt = nonnegativeSafeInteger(task.updatedAt, `Agent 任务文件[${index}].updatedAt`)
    const threadRef = record(task.threadRef, `Agent 任务文件[${index}].threadRef`)
    assertOnlyKeys(threadRef, ["fileSystemId", "fileId"], `Agent 任务文件[${index}].threadRef`)
    return {
      id,
      threadRef: {
        fileSystemId: requiredString(
          threadRef.fileSystemId,
          `Agent 任务文件[${index}].threadRef.fileSystemId`,
        ),
        fileId: requiredFileId(threadRef.fileId, `Agent 任务文件[${index}].threadRef.fileId`),
      },
      workspaceId: requiredString(task.workspaceId, `Agent 任务文件[${index}].workspaceId`),
      status: task.status as AgentTaskStatus,
      updatedAt,
    }
  })
}

export function decodeAgentWorkspaceCreateResult(value: unknown): AgentWorkspaceCreateResult {
  const result = record(value, "创建工作区结果")
  assertOnlyKeys(result, ["workspaceId", "name"], "创建工作区结果")
  return {
    workspaceId: requiredString(result.workspaceId, "创建工作区结果.workspaceId"),
    name: boundedString(result.name, "创建工作区结果.name"),
  }
}

export function decodeAgentWorkspaceCreateInput(value: unknown): AgentWorkspaceCreateInput {
  if (value === undefined) return {}
  const input = record(value, "创建工作区输入")
  assertOnlyKeys(input, ["name"], "创建工作区输入")
  return input.name === undefined ? {} : { name: requiredString(input.name, "创建工作区输入.name") }
}

export function decodeAgentWorkspaceActivateInput(value: unknown): AgentWorkspaceActivateInput {
  const input = record(value, "激活工作区输入")
  assertOnlyKeys(input, ["workspaceId"], "激活工作区输入")
  return { workspaceId: requiredString(input.workspaceId, "激活工作区输入.workspaceId") }
}

export function decodeAgentWorkspaceActivateResult(value: unknown): AgentWorkspaceActivateResult {
  const result = record(value, "激活工作区结果")
  assertOnlyKeys(result, ["workspaceId"], "激活工作区结果")
  return { workspaceId: requiredString(result.workspaceId, "激活工作区结果.workspaceId") }
}
