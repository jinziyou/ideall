import assert from "node:assert/strict"
import { test } from "node:test"
import { sameFileRef, type FileRef } from "@protocol/file-system"
import { AGENT_TASKS_FILE_REF } from "@/filesystem/builtin-app-roots"
import { FileSystemError } from "@/filesystem/types"
import { createAgentConfigFileSystem } from "./agent-config-file-system"
import { importAgentConfigJsonWithFileLocks } from "./agent-settings-write-adapter"
import type { AgentTask } from "./lib/agent-tasks"
import type { AgentThread } from "./lib/model"
import {
  createAgentTaskWriteAdapter,
  withAgentTasksFileWriteLock,
  type AgentTaskWriteAdapterDeps,
} from "./agent-task-write-adapter"

const THREAD: AgentThread = {
  id: "thread-1",
  title: "Task thread",
  messages: [],
  createdAt: 1,
  updatedAt: 1,
}

const TASK: AgentTask = {
  id: THREAD.id,
  workspaceId: "workspace-1",
  status: "active",
  starred: false,
  createdAt: 1,
  updatedAt: 1,
}

const UI_CONTENT = { actor: "ui", permissions: [], intent: "content" } as const
const UI_WRITE = { actor: "ui", permissions: [], intent: "write" } as const

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function mutationDeps(events: string[]): AgentTaskWriteAdapterDeps {
  return {
    async refreshTasksRaw() {
      events.push("refresh")
    },
    async createTaskThread(workspaceId) {
      events.push(`create-thread:${workspaceId}`)
      return THREAD
    },
    async createTask(workspaceId) {
      events.push(`create-task:${workspaceId}`)
      return TASK
    },
    async attachTask(workspaceId, threadId) {
      events.push(`attach:${workspaceId}:${threadId}`)
    },
    async touchTask(id) {
      events.push(`touch:${id}`)
    },
    async setTaskStatus(id, status) {
      events.push(`status:${id}:${status}`)
    },
    async setTaskStarred(id, starred) {
      events.push(`starred:${id}:${starred}`)
    },
    async deleteTask(id, expectedThreadUpdatedAt) {
      events.push(
        expectedThreadUpdatedAt === undefined
          ? `delete:${id}`
          : `delete:${id}:${expectedThreadUpdatedAt}`,
      )
    },
    async deleteTaskOrThread(id) {
      events.push(`delete-thread:${id}`)
    },
    async replaceTasks(tasks) {
      events.push(`replace:${tasks.length}`)
    },
  }
}

test("agent task write adapter: every runtime mutation refreshes under the canonical tasks lock", async () => {
  const events: string[] = []
  const lockedRefs: FileRef[] = []
  const lock = async <T>(ref: FileRef, operation: () => T | Promise<T>): Promise<T> => {
    lockedRefs.push(ref)
    events.push("lock:start")
    try {
      return await operation()
    } finally {
      events.push("lock:end")
    }
  }
  const adapter = createAgentTaskWriteAdapter(mutationDeps(events), lock)
  const operations: ReadonlyArray<readonly [string, () => Promise<unknown>]> = [
    ["create-thread:workspace-1", () => adapter.createTaskThread("workspace-1")],
    ["create-task:workspace-1", () => adapter.createTask("workspace-1")],
    ["attach:workspace-1:thread-1", () => adapter.attachTask("workspace-1", "thread-1")],
    ["touch:thread-1", () => adapter.touchTask("thread-1")],
    ["status:thread-1:done", () => adapter.setTaskStatus("thread-1", "done")],
    ["starred:thread-1:true", () => adapter.setTaskStarred("thread-1", true)],
    ["delete:thread-1", () => adapter.deleteTask("thread-1")],
    ["delete:thread-1:9", () => adapter.deleteTask("thread-1", 9)],
    ["delete-thread:thread-1", () => adapter.deleteTaskOrThread("thread-1")],
    ["replace:1", () => adapter.replaceTasks([TASK])],
  ]

  for (const [rawEvent, operation] of operations) {
    events.length = 0
    await operation()
    assert.deepEqual(events, ["lock:start", "refresh", rawEvent, "lock:end"])
  }

  assert.equal(lockedRefs.length, operations.length)
  assert.ok(lockedRefs.every((ref) => sameFileRef(ref, AGENT_TASKS_FILE_REF)))
})

test("agent task write adapter: a runtime mutation serializes with other tasks FileRef writers", async () => {
  const mutationEntered = deferred()
  const releaseMutation = deferred()
  const events: string[] = []
  const deps = mutationDeps(events)
  const adapter = createAgentTaskWriteAdapter({
    ...deps,
    async createTaskThread() {
      events.push("runtime:start")
      mutationEntered.resolve()
      await releaseMutation.promise
      events.push("runtime:end")
      return THREAD
    },
  })

  const runtimeMutation = adapter.createTaskThread("workspace-1")
  await mutationEntered.promise

  let competingWriterEntered = false
  const competingWriter = withAgentTasksFileWriteLock(() => {
    competingWriterEntered = true
    events.push("provider")
  })
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(competingWriterEntered, false)

  releaseMutation.resolve()
  await Promise.all([runtimeMutation, competingWriter])
  assert.deepEqual(events, ["refresh", "runtime:start", "runtime:end", "provider"])
})

test("agent task write adapter: queued provider CAS observes the completed runtime mutation", async () => {
  const runtimeEntered = deferred()
  const releaseRuntime = deferred()
  let tasks: AgentTask[] = [TASK]
  let providerWrites = 0
  const provider = createAgentConfigFileSystem({
    read(section) {
      assert.equal(section, "tasks")
      return tasks
    },
    write(section, value) {
      assert.equal(section, "tasks")
      providerWrites += 1
      tasks = value as AgentTask[]
    },
    subscribe() {
      return () => undefined
    },
  })
  const stale = await provider.read(AGENT_TASKS_FILE_REF, UI_CONTENT)
  const events: string[] = []
  const deps = mutationDeps(events)
  const adapter = createAgentTaskWriteAdapter({
    ...deps,
    async setTaskStatus(id, status) {
      assert.equal(id, TASK.id)
      assert.equal(status, "done")
      events.push("runtime:start")
      runtimeEntered.resolve()
      await releaseRuntime.promise
      tasks = tasks.map((task) =>
        task.id === id ? { ...task, status, updatedAt: task.updatedAt + 1 } : task,
      )
      events.push("runtime:end")
    },
  })

  const runtimeMutation = adapter.setTaskStatus(TASK.id, "done")
  await runtimeEntered.promise
  let providerSettled = false
  const providerWrite = provider
    .write(AGENT_TASKS_FILE_REF, { data: stale.data, expectedVersion: stale.version }, UI_WRITE)
    .finally(() => {
      providerSettled = true
    })
  const providerFailure = assert.rejects(
    providerWrite,
    (error) => error instanceof FileSystemError && error.code === "conflict",
  )
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(providerSettled, false)
  assert.equal(providerWrites, 0)

  releaseRuntime.resolve()
  await runtimeMutation
  await providerFailure
  assert.equal(providerWrites, 0, "stale provider input must not reach the raw task writer")
  assert.deepEqual(events, ["refresh", "runtime:start", "runtime:end"])
})

test("agent task write adapter: a failed runtime mutation releases the importer", async () => {
  const runtimeEntered = deferred()
  const releaseRuntime = deferred()
  const events: string[] = []
  const deps = mutationDeps(events)
  const adapter = createAgentTaskWriteAdapter({
    ...deps,
    async touchTask() {
      events.push("runtime:start")
      runtimeEntered.resolve()
      await releaseRuntime.promise
      events.push("runtime:failed")
      throw new Error("task transaction failed")
    },
  })

  const runtimeFailure = assert.rejects(adapter.touchTask(TASK.id), /task transaction failed/)
  await runtimeEntered.promise
  let importerEntered = false
  const imported = importAgentConfigJsonWithFileLocks("agent-package", async () => {
    importerEntered = true
    events.push("import")
    return { keys: 1 }
  })
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(importerEntered, false)

  releaseRuntime.resolve()
  await runtimeFailure
  assert.deepEqual(await imported, { keys: 1 })
  assert.deepEqual(events, ["refresh", "runtime:start", "runtime:failed", "import"])
})

test("agent task write adapter: refresh failures skip raw mutation and release the lock", async () => {
  const events: string[] = []
  let refreshAttempts = 0
  const deps = mutationDeps(events)
  const adapter = createAgentTaskWriteAdapter({
    ...deps,
    async refreshTasksRaw() {
      refreshAttempts += 1
      events.push(`refresh:${refreshAttempts}`)
      if (refreshAttempts === 1) throw new Error("refresh failed")
    },
  })

  await assert.rejects(adapter.touchTask("thread-1"), /refresh failed/)
  await adapter.touchTask("thread-1")

  assert.deepEqual(events, ["refresh:1", "refresh:2", "touch:thread-1"])
})
