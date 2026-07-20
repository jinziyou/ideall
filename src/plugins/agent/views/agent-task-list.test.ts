import assert from "node:assert/strict"
import { test } from "node:test"
import {
  fileRefKey,
  type DirectoryEntry,
  type FileRef,
  type IdeallFile,
} from "@protocol/file-system"
import type { FileSystemWatchEvent } from "@/filesystem/types"
import type { AgentWorkspaceSummary } from "../agent-management-file-contract"
import {
  AGENT_TASK_PAGE_SIZE,
  AGENT_THREAD_COLLECTION_REF,
  ThreadMetadataBatchController,
  applyThreadMetadataOutcome,
  buildAgentTaskListItems,
  decodeAgentTaskDirectoryEntry,
  prepareThreadMetadataState,
  threadFileRefsForItems,
  threadTitleFromFile,
  threadTitlesFromFiles,
  type AgentTaskListItem,
  type ThreadMetadataBatchGateway,
  type ThreadMetadataBatchOutcome,
} from "./agent-task-list"

function threadFile(ref: FileRef, name: string): IdeallFile {
  return {
    ref,
    kind: "file",
    name,
    mediaType: "application/vnd.ideall.thread+json",
    capabilities: ["read", "watch"],
    source: { kind: "local", id: "ideall.nodes" },
    properties: { resourceKind: "thread" },
  }
}

function threadRef(id: string): FileRef {
  return { fileSystemId: "test.threads", fileId: `thread:${id}` }
}

function taskEntry(
  id: string,
  {
    workspaceId = "space-a",
    status = "active",
    updatedAt = 1,
    target = threadRef(id),
  }: {
    workspaceId?: string
    status?: "active" | "running" | "done" | "failed"
    updatedAt?: number
    target?: FileRef
  } = {},
): DirectoryEntry {
  return {
    entryId: id,
    parent: { fileSystemId: "ideall.agent.config", fileId: "config:tasks" },
    target,
    name: id,
    kind: "link",
    properties: { taskId: id, workspaceId, status, updatedAt },
  }
}

function taskListItem(id: string, ref: FileRef = threadRef(id)): AgentTaskListItem {
  return {
    id,
    threadRef: ref,
    workspaceId: "space-a",
    workspaceName: "研究",
    workspaceAvailable: true,
    status: "active",
    updatedAt: 1,
  }
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function successfulOutcome(
  outcome: ThreadMetadataBatchOutcome | undefined,
): Extract<ThreadMetadataBatchOutcome, { status: "success" }> {
  assert.equal(outcome?.status, "success")
  if (!outcome || outcome.status !== "success") throw new Error("Expected successful batch")
  return outcome
}

function watchEvent(changes?: readonly FileSystemWatchEvent[]): FileSystemWatchEvent {
  return {
    type: "changed",
    ref: AGENT_THREAD_COLLECTION_REF,
    ...(changes === undefined ? {} : { changes }),
  }
}

test("agent task list: decodes a directory page in provider order and joins workspaces", () => {
  const olderThreadRef = threadRef("older")
  const newerThreadRef = threadRef("newer")
  const entries = [
    taskEntry("older", {
      target: olderThreadRef,
      workspaceId: "space-a",
      status: "done",
      updatedAt: 10,
    }),
    taskEntry("newer", {
      target: newerThreadRef,
      workspaceId: "space-b",
      status: "running",
      updatedAt: 20,
    }),
  ]
  const workspaces = [
    { id: "space-a", name: "研究", taskCount: 1 },
    { id: "space-b", name: "写作", taskCount: 1 },
  ] as AgentWorkspaceSummary[]

  assert.deepEqual(buildAgentTaskListItems(entries, workspaces), [
    {
      id: "older",
      threadRef: olderThreadRef,
      workspaceId: "space-a",
      workspaceName: "研究",
      workspaceAvailable: true,
      status: "done",
      updatedAt: 10,
    },
    {
      id: "newer",
      threadRef: newerThreadRef,
      workspaceId: "space-b",
      workspaceName: "写作",
      workspaceAvailable: true,
      status: "running",
      updatedAt: 20,
    },
  ])
})

test("agent task list: rejects malformed directory properties and keeps orphan labels safe", () => {
  const missingThreadRef = threadRef("missing-thread")
  assert.deepEqual(
    buildAgentTaskListItems(
      [
        taskEntry("missing-thread", {
          target: missingThreadRef,
          workspaceId: "missing-space",
          status: "failed",
        }),
      ],
      [],
    ),
    [
      {
        id: "missing-thread",
        threadRef: missingThreadRef,
        workspaceId: "missing-space",
        workspaceName: "空间已删除",
        workspaceAvailable: false,
        status: "failed",
        updatedAt: 1,
      },
    ],
  )

  assert.throws(
    () =>
      decodeAgentTaskDirectoryEntry({
        ...taskEntry("task-a"),
        properties: {
          taskId: "different-id",
          workspaceId: "space-a",
          status: "active",
          updatedAt: 1,
        },
      }),
    /identity is inconsistent/,
  )
  assert.throws(
    () =>
      decodeAgentTaskDirectoryEntry({
        ...taskEntry("task-a"),
        properties: {
          taskId: "task-a",
          workspaceId: "space-a",
          status: "unknown",
          updatedAt: 1,
        },
      }),
    /status is invalid/,
  )
})

test("agent task list: resolves titles only from expected thread FileRef metadata", () => {
  const ref = { fileSystemId: "ideall.core", fileId: "resource:thread-1" }
  const file = {
    ref,
    kind: "file",
    name: " 任务标题 ",
    mediaType: "application/vnd.ideall.node.thread+json",
    capabilities: ["read", "watch"],
    source: { kind: "system", id: "ideall" },
    properties: { resourceKind: "thread" },
  } as const

  assert.equal(threadTitleFromFile(file, ref), "任务标题")
  assert.equal(threadTitleFromFile({ ...file, name: "   " }, ref), "未命名任务")
  assert.equal(
    threadTitleFromFile(file, { fileSystemId: "ideall.core", fileId: "resource:other" }),
    null,
  )
  assert.equal(threadTitleFromFile({ ...file, properties: { resourceKind: "note" } }, ref), null)
})

test("agent task list: deduplicates thread refs and projects an ordered batch result", () => {
  const duplicateRef = threadRef("shared")
  const items = [
    taskListItem("task-b", duplicateRef),
    taskListItem("task-a"),
    taskListItem("task-c", duplicateRef),
  ]
  const refs = threadFileRefsForItems(items)

  assert.equal(refs.length, 2)
  assert.deepEqual(refs.map(fileRefKey), [...refs.map(fileRefKey)].sort())
  assert.deepEqual(
    [...threadTitlesFromFiles(refs, [threadFile(refs[0]!, " 标题 A "), null])],
    [
      [fileRefKey(refs[0]!), "标题 A"],
      [fileRefKey(refs[1]!), null],
    ],
  )
})

test("agent task list: one visible page batches at most 64 stats and owns one watch", async () => {
  const refs = threadFileRefsForItems(
    Array.from({ length: AGENT_TASK_PAGE_SIZE }, (_, index) => taskListItem(`thread-${index}`)),
  )
  const statBatches: FileRef[][] = []
  const watchedRefs: FileRef[] = []
  let disposed = 0
  const controller = new ThreadMetadataBatchController(refs, () => {}, {
    async stat(batch) {
      statBatches.push([...batch])
      return new Array<IdeallFile | null>(batch.length).fill(null)
    },
    watch(ref) {
      watchedRefs.push(ref)
      return { dispose: () => disposed++ }
    },
  })

  await controller.start()
  assert.equal(statBatches.length, 1)
  assert.equal(statBatches[0]?.length, 64)
  assert.deepEqual(watchedRefs, [AGENT_THREAD_COLLECTION_REF])
  controller.dispose()
  controller.dispose()
  assert.equal(disposed, 1)
})

test("agent task list: precise collection changes stat only current-page intersections", async () => {
  const refs = threadFileRefsForItems([
    taskListItem("thread-a"),
    taskListItem("thread-b"),
    taskListItem("thread-c"),
  ])
  const outside = threadRef("outside-current-page")
  const statBatches: FileRef[][] = []
  const outcomes: ThreadMetadataBatchOutcome[] = []
  let notify: ((event: FileSystemWatchEvent) => void) | undefined
  const controller = new ThreadMetadataBatchController(refs, (outcome) => outcomes.push(outcome), {
    async stat(batch) {
      statBatches.push([...batch])
      const revision = statBatches.length
      return batch.map((ref) => threadFile(ref, `标题 ${ref.fileId} v${revision}`))
    },
    watch(_ref, listener) {
      notify = listener
      return { dispose() {} }
    },
  })

  await controller.start()
  const initial = applyThreadMetadataOutcome(
    prepareThreadMetadataState({ titles: new Map(), loadingKeys: new Set() }, refs),
    outcomes[0]!,
  )
  notify?.(
    watchEvent([
      { type: "changed", ref: refs[1]! },
      { type: "changed", ref: outside },
      { type: "changed", ref: refs[1]! },
    ]),
  )
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(statBatches.length, 2)
  assert.deepEqual(statBatches[1], [refs[1]])
  assert.equal(successfulOutcome(outcomes[1]).mode, "patch")
  const patched = applyThreadMetadataOutcome(initial, outcomes[1]!)
  assert.equal(patched.titles.get(fileRefKey(refs[0]!)), initial.titles.get(fileRefKey(refs[0]!)))
  assert.equal(patched.titles.get(fileRefKey(refs[1]!)), `标题 ${refs[1]!.fileId} v2`)

  notify?.(watchEvent([{ type: "changed", ref: outside }]))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(statBatches.length, 2)
  controller.dispose()
})

test("agent task list: absent or malformed change details fall back to a full page refresh", async () => {
  const refs = threadFileRefsForItems([taskListItem("thread-a"), taskListItem("thread-b")])
  const statBatches: FileRef[][] = []
  let notify: ((event: FileSystemWatchEvent) => void) | undefined
  const controller = new ThreadMetadataBatchController(refs, () => {}, {
    async stat(batch) {
      statBatches.push([...batch])
      return new Array<IdeallFile | null>(batch.length).fill(null)
    },
    watch(_ref, listener) {
      notify = listener
      return { dispose() {} }
    },
  })

  await controller.start()
  notify?.(watchEvent())
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(statBatches[1], refs)

  notify?.(watchEvent([{ type: "changed", ref: null } as unknown as FileSystemWatchEvent]))
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(statBatches[2], refs)
  controller.dispose()
})

test("agent task list: in-flight precise watch bursts add one trailing union batch", async () => {
  const refs = threadFileRefsForItems([taskListItem("thread-a"), taskListItem("thread-b")])
  const first = deferred<Array<IdeallFile | null>>()
  const second = deferred<Array<IdeallFile | null>>()
  const refreshed = deferred<void>()
  const batches: FileRef[][] = []
  let active = 0
  let maxActive = 0
  let notify: ((event: FileSystemWatchEvent) => void) | undefined
  const controller = new ThreadMetadataBatchController(
    refs,
    (outcome) => {
      if (outcome.status === "success" && outcome.mode === "patch") refreshed.resolve(undefined)
    },
    {
      stat(batch) {
        batches.push([...batch])
        active += 1
        maxActive = Math.max(maxActive, active)
        const pending = batches.length === 1 ? first.promise : second.promise
        return pending.finally(() => {
          active -= 1
        })
      },
      watch(_ref, listener) {
        notify = listener
        return { dispose() {} }
      },
    },
  )
  const initial = controller.start()

  for (let index = 0; index < 100; index += 1) {
    notify?.(watchEvent([{ type: "changed", ref: refs[index % refs.length]! }]))
  }
  await Promise.resolve()
  assert.equal(batches.length, 1)
  first.resolve(refs.map((ref) => threadFile(ref, "初始标题")))
  await initial
  await Promise.resolve()
  assert.equal(batches.length, 2)
  assert.deepEqual(batches[1], refs)
  assert.equal(maxActive, 1)
  second.resolve(refs.map((ref) => threadFile(ref, "刷新标题")))
  await refreshed.promise
  assert.equal(batches.length, 2)
  controller.dispose()
})

test("agent task list: malformed batches preserve last-good titles", async () => {
  const refs = threadFileRefsForItems([taskListItem("thread-a"), taskListItem("thread-b")])
  let calls = 0
  let notify: ((event: FileSystemWatchEvent) => void) | undefined
  const outcomes: ThreadMetadataBatchOutcome[] = []
  const controller = new ThreadMetadataBatchController(refs, (outcome) => outcomes.push(outcome), {
    async stat(batch) {
      calls += 1
      if (calls === 1) return batch.map((ref) => threadFile(ref, `标题 ${ref.fileId}`))
      return []
    },
    watch(_ref, listener) {
      notify = listener
      return { dispose() {} }
    },
  })

  await controller.start()
  const loadedState = applyThreadMetadataOutcome(
    prepareThreadMetadataState({ titles: new Map(), loadingKeys: new Set() }, refs),
    outcomes[0]!,
  )
  notify?.(watchEvent([{ type: "changed", ref: refs[0]! }]))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(outcomes.at(-1)?.status, "error")
  const failedState = applyThreadMetadataOutcome(loadedState, outcomes.at(-1)!)
  assert.equal(failedState.titles, loadedState.titles)
  assert.equal(failedState.loadingKeys.size, 0)

  const replacementRef = threadRef("thread-new")
  const changedState = prepareThreadMetadataState(loadedState, [refs[0]!, replacementRef])
  assert.equal(changedState.titles.has(fileRefKey(refs[0]!)), true)
  assert.equal(changedState.titles.has(fileRefKey(refs[1]!)), false)
  assert.deepEqual([...changedState.loadingKeys], [fileRefKey(replacementRef)])
  controller.dispose()
})

test("agent task list: disposed requests cannot publish stale titles", async () => {
  const refs = threadFileRefsForItems([taskListItem("thread-a")])
  const stale = deferred<Array<IdeallFile | null>>()
  const outcomes: ThreadMetadataBatchOutcome[] = []
  const controller = new ThreadMetadataBatchController(refs, (outcome) => outcomes.push(outcome), {
    stat: () => stale.promise,
    watch: () => ({ dispose() {} }),
  })

  const pending = controller.start()
  controller.dispose()
  stale.resolve([threadFile(refs[0]!, "迟到标题")])
  await pending
  assert.deepEqual(outcomes, [])
})
