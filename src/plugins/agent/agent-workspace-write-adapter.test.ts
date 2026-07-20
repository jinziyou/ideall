import assert from "node:assert/strict"
import { test } from "node:test"
import { sameFileRef, type FileRef } from "@protocol/file-system"
import { AGENT_TASKS_FILE_REF, AGENT_WORKSPACES_FILE_REF } from "@/filesystem/builtin-app-roots"
import { importAgentConfigJsonWithFileLocks } from "./agent-settings-write-adapter"
import { defaultWorkspace, type AgentWorkspace } from "./lib/agent-workspace"
import {
  AgentWorkspaceCredentialTargetConflictError,
  agentWorkspaceCredentialTarget,
  createAgentWorkspaceWriteAdapter,
  type AgentWorkspaceWriteAdapterDeps,
} from "./agent-workspace-write-adapter"

const WORKSPACE: AgentWorkspace = {
  ...defaultWorkspace("Test workspace"),
  id: "workspace-1",
  createdAt: 1,
  updatedAt: 1,
}

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function mutationDeps(events: string[]): AgentWorkspaceWriteAdapterDeps {
  return {
    async refreshWorkspacesRaw() {
      events.push("refresh")
    },
    async updateWorkspace(id, updater) {
      events.push(`update:${id}`)
      return updater(WORKSPACE)
    },
    async createWorkspace(name) {
      events.push(`create:${name ?? "default"}`)
      return WORKSPACE
    },
    async deleteWorkspace(id) {
      events.push(`delete:${id}`)
    },
    async renameWorkspace(id, name) {
      events.push(`rename:${id}:${name}`)
    },
    async setActiveWorkspace(id) {
      events.push(`activate:${id}`)
    },
  }
}

test("agent workspace write adapter: every runtime mutation locks tasks then workspaces and refreshes before Raw", async () => {
  const events: string[] = []
  const lockedRefs: FileRef[] = []
  const lock = async <T>(ref: FileRef, operation: () => T | Promise<T>): Promise<T> => {
    lockedRefs.push(ref)
    events.push(`lock:${ref.fileId}:start`)
    try {
      return await operation()
    } finally {
      events.push(`lock:${ref.fileId}:end`)
    }
  }
  const adapter = createAgentWorkspaceWriteAdapter(mutationDeps(events), lock)
  const operations: ReadonlyArray<readonly [string, () => Promise<unknown>]> = [
    [
      "update:workspace-1",
      () => adapter.updateWorkspace("workspace-1", (current) => ({ ...current, name: "Updated" })),
    ],
    ["create:Created", () => adapter.createWorkspace("Created")],
    ["delete:workspace-1", () => adapter.deleteWorkspace("workspace-1")],
    ["rename:workspace-1:Renamed", () => adapter.renameWorkspace("workspace-1", "Renamed")],
    ["activate:workspace-1", () => adapter.setActiveWorkspace("workspace-1")],
  ]

  for (const [rawEvent, operation] of operations) {
    events.length = 0
    lockedRefs.length = 0
    await operation()
    assert.deepEqual(lockedRefs, [AGENT_TASKS_FILE_REF, AGENT_WORKSPACES_FILE_REF])
    assert.ok(sameFileRef(lockedRefs[0]!, AGENT_TASKS_FILE_REF))
    assert.ok(sameFileRef(lockedRefs[1]!, AGENT_WORKSPACES_FILE_REF))
    assert.deepEqual(events, [
      `lock:${AGENT_TASKS_FILE_REF.fileId}:start`,
      `lock:${AGENT_WORKSPACES_FILE_REF.fileId}:start`,
      "refresh",
      rawEvent,
      `lock:${AGENT_WORKSPACES_FILE_REF.fileId}:end`,
      `lock:${AGENT_TASKS_FILE_REF.fileId}:end`,
    ])
  }
})

test("agent workspace write adapter: a failed runtime mutation releases the full config importer", async () => {
  const events: string[] = []
  const runtimeEntered = deferred()
  const releaseRuntime = deferred()
  const deps = mutationDeps(events)
  const adapter = createAgentWorkspaceWriteAdapter({
    ...deps,
    async updateWorkspace() {
      events.push("runtime:start")
      runtimeEntered.resolve()
      await releaseRuntime.promise
      events.push("runtime:failed")
      throw new Error("workspace persistence failed")
    },
  })

  const runtimeFailure = assert.rejects(
    adapter.updateWorkspace(WORKSPACE.id, (current) => current),
    /workspace persistence failed/,
  )
  await runtimeEntered.promise

  let importerEntered = false
  const imported = importAgentConfigJsonWithFileLocks("agent-package", async () => {
    importerEntered = true
    events.push("import")
    return { keys: 1 }
  })
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(importerEntered, false, "importer must wait for the runtime workspace writer")

  releaseRuntime.resolve()
  await runtimeFailure
  assert.deepEqual(await imported, { keys: 1 })
  assert.deepEqual(events, ["refresh", "runtime:start", "runtime:failed", "import"])
})

test("agent workspace write adapter: refresh failures skip Raw and do not poison the locks", async () => {
  const events: string[] = []
  let refreshAttempts = 0
  const deps = mutationDeps(events)
  const adapter = createAgentWorkspaceWriteAdapter({
    ...deps,
    async refreshWorkspacesRaw() {
      refreshAttempts += 1
      events.push(`refresh:${refreshAttempts}`)
      if (refreshAttempts === 1) throw new Error("workspace refresh failed")
    },
  })

  await assert.rejects(adapter.renameWorkspace(WORKSPACE.id, "First"), /workspace refresh failed/)
  await adapter.renameWorkspace(WORKSPACE.id, "Second")

  assert.deepEqual(events, ["refresh:1", "refresh:2", `rename:${WORKSPACE.id}:Second`])
})

test("agent workspace write adapter: API key commits reject a stale credential target inside the lock", async () => {
  const current: AgentWorkspace = {
    ...WORKSPACE,
    model: {
      useGlobal: false,
      baseURL: "https://new.example.test/v1",
      model: "model",
      apiKey: "current-key",
    },
  }
  let updaterEntered = false
  let persisted = false
  const deps = mutationDeps([])
  const adapter = createAgentWorkspaceWriteAdapter({
    ...deps,
    async updateWorkspace(id, updater) {
      assert.equal(id, current.id)
      updaterEntered = true
      const next = updater(current)
      persisted = true
      return next
    },
  })
  const staleTarget = agentWorkspaceCredentialTarget("https://old.example.test/v1")

  await assert.rejects(
    adapter.updateWorkspaceApiKey(current.id, staleTarget, "key-for-old-endpoint"),
    AgentWorkspaceCredentialTargetConflictError,
  )
  assert.equal(updaterEntered, true, "the target check must run against the lock-fresh workspace")
  assert.equal(persisted, false)
})

test("agent workspace write adapter: API key commits accept an equivalent canonical target", async () => {
  const current: AgentWorkspace = {
    ...WORKSPACE,
    model: {
      useGlobal: false,
      baseURL: "https://user:pass@api.example.test/v1?from=current#fragment",
      model: "model",
      apiKey: "old-key",
    },
  }
  let persisted: AgentWorkspace | undefined
  const deps = mutationDeps([])
  const adapter = createAgentWorkspaceWriteAdapter({
    ...deps,
    async updateWorkspace(_id, updater) {
      persisted = updater(current)
      return persisted
    },
  })
  const expectedTarget = agentWorkspaceCredentialTarget("https://api.example.test/v1?from=render")

  await adapter.updateWorkspaceApiKey(current.id, expectedTarget, "new-key")
  assert.equal(persisted?.model.apiKey, "new-key")
})
