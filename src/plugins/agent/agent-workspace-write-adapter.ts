import type { FileRef } from "@protocol/file-system"
import { AGENT_TASKS_FILE_REF, AGENT_WORKSPACES_FILE_REF } from "@/filesystem/builtin-app-roots"
import { withFileWriteLock } from "@/filesystem/write-lock"
import {
  createWorkspaceRaw,
  deleteWorkspaceRaw,
  refreshAgentWorkspacesRaw,
  renameWorkspaceRaw,
  setActiveWorkspaceRaw,
  updateWorkspaceRaw,
  workspaceModelCredentialTarget,
} from "./lib/agent-workspace"

type FileWriteLock = <T>(ref: FileRef, operation: () => T | Promise<T>) => Promise<T>

export type AgentWorkspaceWriteAdapterDeps = Readonly<{
  refreshWorkspacesRaw: typeof refreshAgentWorkspacesRaw
  updateWorkspace: typeof updateWorkspaceRaw
  createWorkspace: typeof createWorkspaceRaw
  deleteWorkspace: typeof deleteWorkspaceRaw
  renameWorkspace: typeof renameWorkspaceRaw
  setActiveWorkspace: typeof setActiveWorkspaceRaw
}>

const defaultDeps: AgentWorkspaceWriteAdapterDeps = {
  refreshWorkspacesRaw: refreshAgentWorkspacesRaw,
  updateWorkspace: updateWorkspaceRaw,
  createWorkspace: createWorkspaceRaw,
  deleteWorkspace: deleteWorkspaceRaw,
  renameWorkspace: renameWorkspaceRaw,
  setActiveWorkspace: setActiveWorkspaceRaw,
}

export type AgentWorkspaceCredentialTarget = ReturnType<typeof workspaceModelCredentialTarget>

export class AgentWorkspaceCredentialTargetConflictError extends Error {
  constructor() {
    super("Agent workspace credential target changed")
    this.name = "AgentWorkspaceCredentialTargetConflictError"
  }
}

/** Re-export the core canonicalizer so UI preconditions and secure records share one identity. */
export const agentWorkspaceCredentialTarget = workspaceModelCredentialTarget

/** Workspace 的统一写屏障；顺序必须与 provider 及整包 importer 保持 tasks→workspaces。 */
export function withAgentWorkspaceFileWriteLocks<T>(
  operation: () => T | Promise<T>,
  lock: FileWriteLock = withFileWriteLock,
): Promise<T> {
  return lock(AGENT_TASKS_FILE_REF, () => lock(AGENT_WORKSPACES_FILE_REF, operation))
}

/**
 * runtime mutation 在双锁内先重读耐久 workspace revision，再调用无锁原语。
 * provider/importer 已持有相同 FileRef 锁，只能直接调用 Raw，禁止进入本 adapter。
 */
export function createAgentWorkspaceWriteAdapter(
  deps: AgentWorkspaceWriteAdapterDeps = defaultDeps,
  lock: FileWriteLock = withFileWriteLock,
) {
  function mutate<T>(operation: () => T | Promise<T>): Promise<T> {
    return withAgentWorkspaceFileWriteLocks(async () => {
      await deps.refreshWorkspacesRaw()
      return operation()
    }, lock)
  }

  return Object.freeze({
    updateWorkspace: (...args: Parameters<typeof updateWorkspaceRaw>) =>
      mutate(() => deps.updateWorkspace(...args)),
    createWorkspace: (...args: Parameters<typeof createWorkspaceRaw>) =>
      mutate(() => deps.createWorkspace(...args)),
    deleteWorkspace: (...args: Parameters<typeof deleteWorkspaceRaw>) =>
      mutate(() => deps.deleteWorkspace(...args)),
    renameWorkspace: (...args: Parameters<typeof renameWorkspaceRaw>) =>
      mutate(() => deps.renameWorkspace(...args)),
    setActiveWorkspace: (...args: Parameters<typeof setActiveWorkspaceRaw>) =>
      mutate(() => deps.setActiveWorkspace(...args)),
    updateWorkspaceApiKey: (
      workspaceId: string,
      expectedTarget: AgentWorkspaceCredentialTarget,
      apiKey: string,
    ) =>
      mutate(() =>
        deps.updateWorkspace(workspaceId, (current) => {
          const currentTarget = workspaceModelCredentialTarget(current.model.baseURL)
          if (
            current.model.useGlobal ||
            expectedTarget === null ||
            currentTarget !== expectedTarget
          ) {
            throw new AgentWorkspaceCredentialTargetConflictError()
          }
          return { ...current, model: { ...current.model, apiKey } }
        }),
      ),
  })
}

export type AgentWorkspaceWriteAdapter = ReturnType<typeof createAgentWorkspaceWriteAdapter>

const runtimeAgentWorkspaceWriter = createAgentWorkspaceWriteAdapter()

export const updateWorkspace = runtimeAgentWorkspaceWriter.updateWorkspace
export const createWorkspace = runtimeAgentWorkspaceWriter.createWorkspace
export const deleteWorkspace = runtimeAgentWorkspaceWriter.deleteWorkspace
export const renameWorkspace = runtimeAgentWorkspaceWriter.renameWorkspace
export const setActiveWorkspace = runtimeAgentWorkspaceWriter.setActiveWorkspace
export const updateWorkspaceApiKey = runtimeAgentWorkspaceWriter.updateWorkspaceApiKey
