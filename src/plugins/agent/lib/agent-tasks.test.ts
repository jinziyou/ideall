import assert from "node:assert/strict"
import { test } from "node:test"
import { registerFilesPort, type FilesPort, type Thread, type ThreadTask } from "@protocol/files"
import { FILES_UPDATED } from "@protocol/flowback"
import { AGENT_TASKS_FILE_REF } from "@/filesystem/builtin-app-roots"
import { withFileWriteLock } from "@/filesystem/write-lock"
import { MAX_AGENT_TASK_ITEMS } from "../agent-management-file-contract"
import {
  attachTaskRaw,
  createTaskThreadRaw,
  deleteTaskOrThreadRaw,
  deleteTaskRaw,
  ensureTasksReady,
  getTasks,
  refreshTasks,
  replaceTasksRaw,
  subscribeTasks,
  type AgentTask,
} from "./agent-tasks"

let revisionSeed = 100

function nextRevision(): number {
  revisionSeed += 1
  return revisionSeed
}

function task(index: number, patch: Partial<AgentTask> = {}): AgentTask {
  return {
    id: `thread-${index}`,
    workspaceId: "workspace-1",
    status: "active",
    starred: false,
    createdAt: index,
    updatedAt: index,
    ...patch,
  }
}

function thread(id: string): Thread {
  return { id, title: "新对话", messages: [], createdAt: 1, updatedAt: 1 }
}

function installWindow(): { target: EventTarget; restore: () => void } {
  const previous = globalThis.window
  const target = new EventTarget()
  Object.defineProperty(globalThis, "window", { value: target, configurable: true })
  return {
    target,
    restore() {
      if (previous === undefined) Reflect.deleteProperty(globalThis, "window")
      else Object.defineProperty(globalThis, "window", { value: previous, configurable: true })
    },
  }
}

function filesEvent(kind: string): Event {
  const event = new Event(FILES_UPDATED)
  Object.defineProperty(event, "detail", { value: { kind } })
  return event
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

test("agent tasks: subscribe initial hydration waits for the canonical tasks lock", async () => {
  const readEntered = deferred<void>()
  let readCalls = 0
  const unregister = registerFilesPort({
    async listThreadTasks() {
      readCalls += 1
      readEntered.resolve()
      return { revision: nextRevision(), tasks: [] }
    },
  } as unknown as FilesPort)
  const lockEntered = deferred<void>()
  const releaseLock = deferred<void>()
  const holder = withFileWriteLock(AGENT_TASKS_FILE_REF, async () => {
    lockEntered.resolve()
    await releaseLock.promise
  })
  let unsubscribe = () => {}

  try {
    await lockEntered.promise
    unsubscribe = subscribeTasks(() => {})
    await flushPromises()
    assert.equal(readCalls, 0, "subscribe must not hydrate outside the tasks lock")

    releaseLock.resolve()
    await holder
    await readEntered.promise
    await flushPromises()
    assert.equal(readCalls, 1)
  } finally {
    releaseLock.resolve()
    await holder
    unsubscribe()
    unregister()
  }
})

test("agent tasks: create failure publishes no partial snapshot", async () => {
  const initialRevision = nextRevision()
  const unregister = registerFilesPort({
    async listThreadTasks() {
      return { revision: initialRevision, tasks: [task(1)] }
    },
    async createTaskThread() {
      throw new Error("IndexedDB transaction aborted")
    },
  } as unknown as FilesPort)

  try {
    await refreshTasks()
    const before = getTasks()
    await assert.rejects(createTaskThreadRaw("workspace-1"), /transaction aborted/)
    assert.strictEqual(getTasks(), before)
    assert.deepEqual(getTasks(), [task(1)])
  } finally {
    unregister()
  }
})

test("agent tasks: successful create publishes the transaction result", async () => {
  const initialRevision = nextRevision()
  const createdRevision = nextRevision()
  const createdTask = task(2, { workspaceId: "workspace-created", updatedAt: 20 })
  const unregister = registerFilesPort({
    async listThreadTasks() {
      return { revision: initialRevision, tasks: [] }
    },
    async createTaskThread(workspaceId: string) {
      assert.equal(workspaceId, "workspace-created")
      return { thread: thread(createdTask.id), task: createdTask, revision: createdRevision }
    },
  } as unknown as FilesPort)

  try {
    await refreshTasks()
    const created = await createTaskThreadRaw("workspace-created")
    assert.equal(created.id, createdTask.id)
    assert.deepEqual(getTasks(), [createdTask])
  } finally {
    unregister()
  }
})

test("agent tasks: revision gaps force a full refresh before the write returns", async () => {
  const initialRevision = nextRevision()
  nextRevision() // 模拟其它窗口在当前写之前提交了一次。
  const mutationRevision = nextRevision()
  const initial = task(20, { updatedAt: 20 })
  const attached = task(21, { updatedAt: 21 })
  const external = task(22, { workspaceId: "workspace-external", updatedAt: 22 })
  let committed = false
  let listCalls = 0
  const unregister = registerFilesPort({
    async listThreadTasks() {
      listCalls += 1
      return committed
        ? { revision: mutationRevision, tasks: [external, attached, initial] }
        : { revision: initialRevision, tasks: [initial] }
    },
    async attachThreadTask() {
      committed = true
      return { revision: mutationRevision, task: attached }
    },
  } as unknown as FilesPort)

  try {
    await refreshTasks()
    await attachTaskRaw(attached.workspaceId, attached.id)
    assert.equal(listCalls, 2)
    assert.deepEqual(getTasks(), [external, attached, initial])
  } finally {
    unregister()
  }
})

test("agent tasks: delete failure keeps the same visible snapshot", async () => {
  const initialRevision = nextRevision()
  const existing = task(3)
  const unregister = registerFilesPort({
    async listThreadTasks() {
      return { revision: initialRevision, tasks: [existing] }
    },
    async deleteTaskThread() {
      throw new Error("IndexedDB unavailable")
    },
  } as unknown as FilesPort)

  try {
    await refreshTasks()
    const before = getTasks()
    await assert.rejects(deleteTaskRaw(existing.id), /IndexedDB unavailable/)
    assert.strictEqual(getTasks(), before)
    assert.deepEqual(getTasks(), [existing])
  } finally {
    unregister()
  }
})

test("agent tasks: version-bound delete reaches the atomic storage operation", async () => {
  const initialRevision = nextRevision()
  const deletedRevision = nextRevision()
  const existing = task(31)
  let received: { id: string; expected?: number } | undefined
  const unregister = registerFilesPort({
    async listThreadTasks() {
      return { revision: initialRevision, tasks: [existing] }
    },
    async deleteTaskThread(id: string, expected?: { updatedAt: number }) {
      received = { id, expected: expected?.updatedAt }
      return { revision: deletedRevision }
    },
  } as unknown as FilesPort)

  try {
    await refreshTasks()
    await deleteTaskRaw(existing.id, 77)
    assert.deepEqual(received, { id: existing.id, expected: 77 })
  } finally {
    unregister()
  }
})

test("agent tasks: every global delete uses the atomic task/thread operation", async () => {
  const initialRevision = nextRevision()
  const deletedRevision = nextRevision()
  const deleted: string[] = []
  const unregister = registerFilesPort({
    async listThreadTasks() {
      return { revision: initialRevision, tasks: [] }
    },
    async deleteTaskThread(id: string) {
      deleted.push(id)
      return { revision: deletedRevision }
    },
    async deleteThread() {
      assert.fail("deleteThread must not be used")
    },
  } as unknown as FilesPort)

  try {
    await refreshTasks()
    await deleteTaskOrThreadRaw("ordinary-thread")
    assert.deepEqual(deleted, ["ordinary-thread"])
  } finally {
    unregister()
  }
})

test("agent tasks: replace uses the current revision as CAS and preserves snapshot on conflict", async () => {
  const initialRevision = nextRevision()
  const existing = task(4)
  let expectedRevision: number | undefined
  let conflict = true
  const replacement = task(5)
  const successRevision = nextRevision()
  const unregister = registerFilesPort({
    async listThreadTasks() {
      return { revision: initialRevision, tasks: [existing] }
    },
    async replaceThreadTasks(tasks: readonly ThreadTask[], expected: number | undefined) {
      expectedRevision = expected
      if (conflict) throw new Error("任务索引已被其它窗口修改")
      return { revision: successRevision, tasks: [...tasks] }
    },
  } as unknown as FilesPort)

  try {
    await refreshTasks()
    const before = getTasks()
    await assert.rejects(replaceTasksRaw([replacement]), /其它窗口修改/)
    assert.equal(expectedRevision, initialRevision)
    assert.strictEqual(getTasks(), before)

    conflict = false
    await replaceTasksRaw([replacement])
    assert.equal(expectedRevision, initialRevision)
    assert.deepEqual(getTasks(), [replacement])
  } finally {
    unregister()
  }
})

test("agent tasks: thread invalidations coalesce into one refresh and publish external state", async () => {
  let currentRevision = nextRevision()
  let currentTasks: ThreadTask[] = [task(6)]
  let listCalls = 0
  const unregister = registerFilesPort({
    async listThreadTasks() {
      listCalls += 1
      return { revision: currentRevision, tasks: [...currentTasks] }
    },
    async readThreadTaskIndexHead() {
      return { revision: currentRevision, count: currentTasks.length }
    },
  } as unknown as FilesPort)
  const browser = installWindow()
  let publications = 0
  let unsubscribe = () => {}

  try {
    await refreshTasks()
    unsubscribe = subscribeTasks(() => {
      publications += 1
    })
    await flushPromises()
    const callsBeforeInvalidation = listCalls

    currentRevision = nextRevision()
    currentTasks = [task(7, { updatedAt: 70 })]
    browser.target.dispatchEvent(filesEvent("thread"))
    browser.target.dispatchEvent(filesEvent("thread"))
    browser.target.dispatchEvent(filesEvent("note"))
    await flushPromises()

    assert.equal(listCalls, callsBeforeInvalidation + 1)
    assert.equal(publications, 1)
    assert.deepEqual(getTasks(), currentTasks)
  } finally {
    unsubscribe()
    browser.restore()
    unregister()
  }
})

test("agent tasks: unchanged durable head skips a full list after thread invalidation", async () => {
  const currentRevision = nextRevision()
  const currentTasks = [task(8)]
  let headCalls = 0
  let listCalls = 0
  const unregister = registerFilesPort({
    async listThreadTasks() {
      listCalls += 1
      return { revision: currentRevision, tasks: currentTasks }
    },
    async readThreadTaskIndexHead() {
      headCalls += 1
      return { revision: currentRevision, count: currentTasks.length }
    },
  } as unknown as FilesPort)
  const browser = installWindow()
  let unsubscribe = () => {}

  try {
    await refreshTasks()
    unsubscribe = subscribeTasks(() => {})
    await flushPromises()
    const listsBefore = listCalls
    const headsBefore = headCalls

    browser.target.dispatchEvent(filesEvent("thread"))
    await flushPromises()

    assert.equal(headCalls, headsBefore + 1)
    assert.equal(listCalls, listsBefore)
  } finally {
    unsubscribe()
    browser.restore()
    unregister()
  }
})

test("agent tasks: invalidation arriving during a stale read forces a tail revalidation", async () => {
  const initialRevision = nextRevision()
  const firstRevision = nextRevision()
  const secondRevision = nextRevision()
  const initial = [task(30, { updatedAt: 30 })]
  const first = [task(31, { updatedAt: 31 })]
  const second = [task(32, { updatedAt: 32 })]
  const staleRead = deferred<{ revision: number; tasks: ThreadTask[] }>()
  let currentRevision = initialRevision
  let currentTasks: ThreadTask[] = initial
  let listCalls = 0
  const unregister = registerFilesPort({
    async listThreadTasks() {
      listCalls += 1
      if (listCalls === 2) return staleRead.promise
      return { revision: currentRevision, tasks: [...currentTasks] }
    },
    async readThreadTaskIndexHead() {
      return { revision: currentRevision, count: currentTasks.length }
    },
  } as unknown as FilesPort)
  const browser = installWindow()
  let unsubscribe = () => {}

  try {
    await refreshTasks()
    unsubscribe = subscribeTasks(() => {})
    await flushPromises()

    currentRevision = firstRevision
    currentTasks = first
    browser.target.dispatchEvent(filesEvent("thread"))
    await flushPromises()
    assert.equal(listCalls, 2)

    currentRevision = secondRevision
    currentTasks = second
    browser.target.dispatchEvent(filesEvent("thread"))
    staleRead.resolve({ revision: firstRevision, tasks: first })
    await flushPromises()
    await flushPromises()

    assert.equal(listCalls, 3)
    assert.deepEqual(getTasks(), second)
  } finally {
    unsubscribe()
    browser.restore()
    unregister()
  }
})

test("agent tasks: pageshow probes the durable head and recovers a missed broadcast", async () => {
  let currentRevision = nextRevision()
  let currentTasks: ThreadTask[] = [task(40)]
  let listCalls = 0
  const unregister = registerFilesPort({
    async listThreadTasks() {
      listCalls += 1
      return { revision: currentRevision, tasks: [...currentTasks] }
    },
    async readThreadTaskIndexHead() {
      return { revision: currentRevision, count: currentTasks.length }
    },
  } as unknown as FilesPort)
  const browser = installWindow()
  let unsubscribe = () => {}

  try {
    await refreshTasks()
    unsubscribe = subscribeTasks(() => {})
    await flushPromises()
    const listsBefore = listCalls

    currentRevision = nextRevision()
    currentTasks = [task(41, { updatedAt: 41 })]
    browser.target.dispatchEvent(new Event("pageshow"))
    await flushPromises()

    assert.equal(listCalls, listsBefore + 1)
    assert.deepEqual(getTasks(), currentTasks)
  } finally {
    unsubscribe()
    browser.restore()
    unregister()
  }
})

test("agent tasks: IDB owns create/attach capacity while replace rejects oversized raw input", async () => {
  const maximum = Array.from({ length: MAX_AGENT_TASK_ITEMS }, (_, index) => task(index))
  const initialRevision = nextRevision()
  let attaches = 0
  let replacements = 0
  const unregister = registerFilesPort({
    async listThreadTasks() {
      return { revision: initialRevision, tasks: maximum }
    },
    async attachThreadTask() {
      attaches += 1
      throw new Error("IDB task capacity exceeded")
    },
    async replaceThreadTasks() {
      replacements += 1
      return { revision: nextRevision(), tasks: [] }
    },
  } as unknown as FilesPort)

  try {
    await refreshTasks()
    await assert.rejects(attachTaskRaw("workspace-1", "overflow"), /IDB task capacity/)
    await assert.rejects(replaceTasksRaw([...maximum, task(MAX_AGENT_TASK_ITEMS)]), /不能超过/)
    assert.equal(attaches, 1)
    assert.equal(replacements, 0)
    assert.equal(getTasks().length, MAX_AGENT_TASK_ITEMS)
  } finally {
    unregister()
  }
})
