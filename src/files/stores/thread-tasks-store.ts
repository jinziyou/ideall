// Agent task 轻量索引与 thread 节点共用一个 IndexedDB 数据库。
// 多实体写只在本层展开原生事务，插件与 FileSystem 仍只消费 @protocol/files 的窄契约。
import {
  MAX_THREAD_TASK_ITEMS,
  ThreadTaskConflictError,
  type Thread,
  type ThreadTask,
  type ThreadTaskIndexHead,
  type ThreadTaskMigration,
  type ThreadTaskMutation,
  type ThreadTaskPatch,
  type ThreadTaskSnapshot,
  type ThreadTaskStatus,
} from "@protocol/files"
import { notifyFilesUpdated } from "@protocol/flowback"
import type { Node, NodeOfKind } from "@protocol/node"
import { addThreadNodeAtTail } from "@/files/stores/thread-node-transaction"
import {
  assertNodeMutationExpectation,
  type NodeMutationExpectation,
} from "@/files/stores/node-mutation"
import { nextUpdatedAt } from "@/files/version"
import { genId } from "@/lib/id"
import {
  idbGet,
  idbGetAll,
  idbRunTransaction,
  INDEX_NODES_DELETED_AT,
  INDEX_NODES_THREAD_METADATA,
  STORE_AGENT_TASKS,
  STORE_NODES,
  STORE_TRASH_SNAPSHOTS,
} from "@/lib/idb"

const STATE_KEY = "state"
const TASK_KEY_PREFIX = "task:"
const TASK_STATUSES = new Set<ThreadTaskStatus>(["active", "running", "done", "failed"])

type ThreadNode = NodeOfKind<"thread">

type StateRow = {
  key: typeof STATE_KEY
  type: "state"
  revision: number
  count: number
  legacyMigrated: boolean
}

type TaskRow = {
  key: string
  type: "task"
  task: ThreadTask
}

type AgentTaskStoreRow = StateRow | TaskRow

type TrashSnapshot = {
  id: string
  node: Node
  capturedAt: number
}

type TransactionOutcome<T> = {
  value: T
  changed: boolean
}

const INITIAL_STATE: StateRow = {
  key: STATE_KEY,
  type: "state",
  revision: 0,
  count: 0,
  legacyMigrated: false,
}

function taskKey(id: string): string {
  return `${TASK_KEY_PREFIX}${id}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function validTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}

function validateTask(value: ThreadTask): ThreadTask {
  if (!isRecord(value)) throw new Error("Agent task 必须是对象")
  if (typeof value.id !== "string" || !value.id.trim()) {
    throw new Error("Agent task id 必须是非空字符串")
  }
  if (typeof value.workspaceId !== "string" || !value.workspaceId.trim()) {
    throw new Error("Agent task workspaceId 必须是非空字符串")
  }
  if (typeof value.status !== "string" || !TASK_STATUSES.has(value.status)) {
    throw new Error("Agent task status 非法")
  }
  if (typeof value.starred !== "boolean") throw new Error("Agent task starred 必须是布尔值")
  if (!validTimestamp(value.createdAt) || !validTimestamp(value.updatedAt)) {
    throw new Error("Agent task 时间戳非法")
  }
  return {
    id: value.id,
    workspaceId: value.workspaceId,
    status: value.status,
    starred: value.starred,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  }
}

function stateValue(rows: readonly unknown[]): unknown {
  return rows.find((row) => isRecord(row) && row.key === STATE_KEY && row.type === "state")
}

function hasStoredCount(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.key === STATE_KEY &&
    value.type === "state" &&
    Number.isSafeInteger(value.revision) &&
    (value.revision as number) >= 0 &&
    Number.isSafeInteger(value.count) &&
    (value.count as number) >= 0 &&
    (value.count as number) <= MAX_THREAD_TASK_ITEMS
  )
}

/** v15 初期 state 没有 count；fallbackCount 由一次兼容扫描得到。 */
function readStateValue(value: unknown, fallbackCount = 0): StateRow {
  if (
    !isRecord(value) ||
    value.key !== STATE_KEY ||
    value.type !== "state" ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0
  ) {
    return { ...INITIAL_STATE, count: fallbackCount }
  }
  return {
    key: STATE_KEY,
    type: "state",
    revision: value.revision as number,
    count: hasStoredCount(value) ? (value.count as number) : fallbackCount,
    legacyMigrated: value.legacyMigrated === true,
  }
}

function readTasks(rows: readonly unknown[]): ThreadTask[] {
  const tasks: ThreadTask[] = []
  for (const row of rows) {
    if (!isRecord(row) || row.type !== "task" || typeof row.key !== "string") continue
    try {
      const task = validateTask(row.task as ThreadTask)
      if (row.key === taskKey(task.id)) tasks.push(task)
    } catch {
      // 内部损坏行不进入公开快照；后续 replace 可一次性清理。
    }
  }
  return sortTasks(tasks)
}

function readTask(value: unknown, id: string): ThreadTask | undefined {
  if (!isRecord(value) || value.type !== "task" || value.key !== taskKey(id)) return undefined
  try {
    const task = validateTask(value.task as ThreadTask)
    return task.id === id ? task : undefined
  } catch {
    return undefined
  }
}

function sortTasks(tasks: readonly ThreadTask[]): ThreadTask[] {
  return [...tasks].sort(
    (left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id),
  )
}

function snapshot(rows: readonly unknown[]): ThreadTaskSnapshot {
  const tasks = readTasks(rows)
  return { revision: readStateValue(stateValue(rows), tasks.length).revision, tasks }
}

function nextRevision(state: StateRow): number {
  if (state.revision >= Number.MAX_SAFE_INTEGER) {
    throw new Error("Agent task revision 已耗尽")
  }
  return state.revision + 1
}

function bumpedState(
  state: StateRow,
  options: { count?: number; legacyMigrated?: boolean } = {},
): StateRow {
  return {
    ...state,
    revision: nextRevision(state),
    count: options.count ?? state.count,
    legacyMigrated: options.legacyMigrated ?? state.legacyMigrated,
  }
}

function taskRow(task: ThreadTask): TaskRow {
  return { key: taskKey(task.id), type: "task", task }
}

type LoadedTaskState = {
  state: StateRow
  /** 旧版/损坏 state 已通过一次全量扫描恢复 count；调用方应在本事务 put 回去。 */
  repaired: boolean
}

/**
 * 高频事务优先只读 state 主键。只有 v15 旧行缺少 count（或 state 损坏）时，才兼容性
 * 扫描一次 task 行并让当前事务回填；之后所有写路径都保持主键点读。
 */
function loadTaskState(
  store: IDBObjectStore,
  complete: (loaded: LoadedTaskState) => void,
  abort: (error: unknown) => void,
): void {
  const request = store.get(STATE_KEY)
  request.onsuccess = () => {
    try {
      const value = request.result as unknown
      if (hasStoredCount(value)) {
        complete({ state: readStateValue(value), repaired: false })
        return
      }
      const rowsRequest = store.getAll()
      rowsRequest.onsuccess = () => {
        try {
          const rows = rowsRequest.result as unknown[]
          complete({
            state: readStateValue(value, readTasks(rows).length),
            repaired: true,
          })
        } catch (error) {
          abort(error)
        }
      }
    } catch (error) {
      abort(error)
    }
  }
}

/** IDBIndex.getAllKeys() 返回的是对象仓库主键；覆盖索引字段必须从 key cursor 读取。 */
function collectIndexKeys(index: IDBIndex, complete: (keys: IDBValidKey[]) => void): void {
  const keys: IDBValidKey[] = []
  const request = index.openKeyCursor()
  request.onsuccess = () => {
    const cursor = request.result
    if (!cursor) {
      complete(keys)
      return
    }
    keys.push(cursor.key)
    cursor.continue()
  }
}

function isThreadMetadataKey(
  value: IDBValidKey,
): value is ["thread", string, string, number, string, number] {
  return (
    Array.isArray(value) &&
    value.length === 6 &&
    value[0] === "thread" &&
    typeof value[1] === "string" &&
    typeof value[2] === "string" &&
    typeof value[3] === "number" &&
    typeof value[4] === "string" &&
    typeof value[5] === "number"
  )
}

function threadIds(metadataKeys: readonly IDBValidKey[]): Set<string> {
  return new Set(metadataKeys.filter(isThreadMetadataKey).map((key) => key[1]))
}

function liveThreadIds(
  metadataKeys: readonly IDBValidKey[],
  deletedPrimaryKeys: readonly IDBValidKey[],
): Set<string> {
  const ids = threadIds(metadataKeys)
  for (const key of deletedPrimaryKeys) {
    if (typeof key === "string") ids.delete(key)
  }
  return ids
}

function threadToNode(thread: Thread, current: ThreadNode, updatedAt: number): ThreadNode {
  return {
    id: current.id,
    kind: "thread",
    title: thread.title,
    parentId: null,
    sortKey: current.sortKey,
    tags: current.tags,
    createdAt: current.createdAt,
    updatedAt,
    content: { messages: thread.messages },
    meta: current.meta,
  }
}

function nodeToThread(node: ThreadNode): Thread {
  return {
    id: node.id,
    title: node.title,
    messages: node.content.messages,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
  }
}

function sameTasks(left: readonly ThreadTask[], right: readonly ThreadTask[]): boolean {
  if (left.length !== right.length) return false
  const a = [...left].sort((x, y) => x.id.localeCompare(y.id))
  const b = [...right].sort((x, y) => x.id.localeCompare(y.id))
  return a.every((task, index) => {
    const other = b[index]
    return (
      task.id === other.id &&
      task.workspaceId === other.workspaceId &&
      task.status === other.status &&
      task.starred === other.starred &&
      task.createdAt === other.createdAt &&
      task.updatedAt === other.updatedAt
    )
  })
}

function validateWorkspaceId(workspaceId: string): void {
  if (typeof workspaceId !== "string" || !workspaceId.trim()) {
    throw new Error("workspaceId 必须是非空字符串")
  }
}

function validatePatch(patch: ThreadTaskPatch): void {
  if (!isRecord(patch)) throw new Error("Agent task patch 必须是对象")
  if (patch.status !== undefined && !TASK_STATUSES.has(patch.status)) {
    throw new Error("Agent task status 非法")
  }
  if (patch.starred !== undefined && typeof patch.starred !== "boolean") {
    throw new Error("Agent task starred 必须是布尔值")
  }
  if (patch.touch !== undefined && typeof patch.touch !== "boolean") {
    throw new Error("Agent task touch 必须是布尔值")
  }
}

/** 同一 readonly 事务取得 task 行和 revision，按最近更新倒序返回。 */
export async function listThreadTasks(): Promise<ThreadTaskSnapshot> {
  return snapshot(await idbGetAll<AgentTaskStoreRow>(STORE_AGENT_TASKS))
}

/**
 * 跨窗口 watcher 的廉价耐久探针。正常路径只读 state 主键；v15 旧 state 缺少 count 时，
 * 在当前事务扫描并回填一次，但不改变公开 revision。
 */
export async function readThreadTaskIndexHead(): Promise<ThreadTaskIndexHead> {
  const current = await idbGet<unknown>(STORE_AGENT_TASKS, STATE_KEY)
  if (hasStoredCount(current)) {
    const state = readStateValue(current)
    return { revision: state.revision, count: state.count }
  }
  return idbRunTransaction<ThreadTaskIndexHead>(
    [STORE_AGENT_TASKS],
    "readwrite",
    (transaction, setResult, abort) => {
      const store = transaction.objectStore(STORE_AGENT_TASKS)
      loadTaskState(
        store,
        ({ state, repaired }) => {
          if (repaired) store.put(state)
          setResult({ revision: state.revision, count: state.count })
        },
        abort,
      )
    },
  )
}

/**
 * 一次性导入旧 localStorage task 快照。marker 与导入行同事务提交；无 live thread、重复、
 * 损坏或超容量的记录都会被跳过，避免产生 dangling task。
 */
export async function migrateLegacyThreadTasks(
  legacyTasks: readonly ThreadTask[],
): Promise<ThreadTaskMigration> {
  const outcome = await idbRunTransaction<TransactionOutcome<ThreadTaskMigration>>(
    [STORE_AGENT_TASKS, STORE_NODES],
    "readwrite",
    (transaction, setResult, abort) => {
      const taskStore = transaction.objectStore(STORE_AGENT_TASKS)
      const nodeStore = transaction.objectStore(STORE_NODES)
      const rowsRequest = taskStore.getAll()
      const deletedRequest = nodeStore.index(INDEX_NODES_DELETED_AT).getAllKeys()
      let rows: unknown[] | undefined
      let metadataKeys: IDBValidKey[] | undefined
      let deletedKeys: IDBValidKey[] | undefined

      const finish = () => {
        if (!rows || !metadataKeys || !deletedKeys) return
        try {
          const current = readTasks(rows)
          const rawState = stateValue(rows)
          const decodedState = readStateValue(rawState, current.length)
          const state = { ...decodedState, count: current.length }
          const stateNeedsRepair =
            !hasStoredCount(rawState) || decodedState.count !== current.length
          if (state.legacyMigrated) {
            if (stateNeedsRepair) taskStore.put(state)
            setResult({
              value: {
                revision: state.revision,
                tasks: current,
                migrated: false,
                imported: 0,
                skipped: 0,
              },
              changed: false,
            })
            return
          }

          const candidates = new Map<string, ThreadTask>()
          for (const value of legacyTasks) {
            try {
              const task = validateTask(value)
              const previous = candidates.get(task.id)
              if (!previous || task.updatedAt > previous.updatedAt) candidates.set(task.id, task)
            } catch {
              // 旧 localStorage 可能被手工改坏；由 skipped 计数暴露，不阻塞其余迁移。
            }
          }

          const liveIds = liveThreadIds(metadataKeys, deletedKeys)
          const byId = new Map(current.map((task) => [task.id, task]))
          const imported: ThreadTask[] = []
          const orderedCandidates = sortTasks([...candidates.values()])
          for (const task of orderedCandidates) {
            if (byId.has(task.id) || !liveIds.has(task.id) || byId.size >= MAX_THREAD_TASK_ITEMS) {
              continue
            }
            byId.set(task.id, task)
            imported.push(task)
          }

          const nextState =
            imported.length > 0
              ? bumpedState(state, { count: byId.size, legacyMigrated: true })
              : {
                  ...state,
                  key: STATE_KEY,
                  type: "state" as const,
                  count: byId.size,
                  legacyMigrated: true,
                }
          taskStore.put(nextState)
          for (const task of imported) taskStore.put(taskRow(task))
          setResult({
            value: {
              revision: nextState.revision,
              tasks: sortTasks([...byId.values()]),
              migrated: true,
              imported: imported.length,
              skipped: legacyTasks.length - imported.length,
            },
            changed: imported.length > 0,
          })
        } catch (error) {
          abort(error)
        }
      }

      rowsRequest.onsuccess = () => {
        rows = rowsRequest.result as unknown[]
        finish()
      }
      collectIndexKeys(nodeStore.index(INDEX_NODES_THREAD_METADATA), (keys) => {
        metadataKeys = keys
        finish()
      })
      deletedRequest.onsuccess = () => {
        deletedKeys = deletedRequest.result
        finish()
      }
    },
  )
  if (outcome.changed) notifyFilesUpdated({ kind: "thread" })
  return outcome.value
}

/** 新建空 thread 与 task；节点、任务行和 revision 同事务生效。 */
export async function createTaskThread(workspaceId: string): Promise<{
  thread: Thread
  task: ThreadTask
  revision: number
}> {
  validateWorkspaceId(workspaceId)
  const now = Date.now()
  const thread: Thread = {
    id: genId("thread"),
    title: "新对话",
    messages: [],
    createdAt: now,
    updatedAt: now,
  }
  const task: ThreadTask = {
    id: thread.id,
    workspaceId,
    status: "active",
    starred: false,
    createdAt: now,
    updatedAt: now,
  }

  const value = await idbRunTransaction<{
    thread: Thread
    task: ThreadTask
    revision: number
  }>([STORE_AGENT_TASKS, STORE_NODES], "readwrite", (transaction, setResult, abort) => {
    const taskStore = transaction.objectStore(STORE_AGENT_TASKS)
    const nodeStore = transaction.objectStore(STORE_NODES)
    let loadedState: LoadedTaskState | undefined
    let nodeAdded = false

    const finish = () => {
      if (!loadedState || !nodeAdded) return
      try {
        if (loadedState.state.count >= MAX_THREAD_TASK_ITEMS) {
          throw new Error(`Agent 任务不能超过 ${MAX_THREAD_TASK_ITEMS} 项`)
        }
        const state = bumpedState(loadedState.state, { count: loadedState.state.count + 1 })
        taskStore.add(taskRow(task))
        taskStore.put(state)
        setResult({ thread, task, revision: state.revision })
      } catch (error) {
        abort(error)
      }
    }

    loadTaskState(
      taskStore,
      (loaded) => {
        loadedState = loaded
        finish()
      },
      abort,
    )
    addThreadNodeAtTail(
      nodeStore,
      thread,
      () => {
        nodeAdded = true
        finish()
      },
      abort,
    )
  })
  notifyFilesUpdated({ kind: "thread", id: value.thread.id })
  return value
}

/** 将 live thread 登记为 task；已有 task 原样返回，不重复 bump revision。 */
export async function attachThreadTask(
  workspaceId: string,
  threadId: string,
): Promise<ThreadTaskMutation> {
  validateWorkspaceId(workspaceId)
  if (typeof threadId !== "string" || !threadId.trim()) {
    throw new Error("threadId 必须是非空字符串")
  }
  const outcome = await idbRunTransaction<TransactionOutcome<ThreadTaskMutation>>(
    [STORE_AGENT_TASKS, STORE_NODES],
    "readwrite",
    (transaction, setResult, abort) => {
      const taskStore = transaction.objectStore(STORE_AGENT_TASKS)
      const nodeStore = transaction.objectStore(STORE_NODES)
      const taskRequest = taskStore.get(taskKey(threadId))
      let loadedState: LoadedTaskState | undefined
      let taskLoaded = false
      let existing: ThreadTask | undefined

      const finish = () => {
        if (!loadedState || !taskLoaded) return
        try {
          if (existing) {
            if (loadedState.repaired) taskStore.put(loadedState.state)
            setResult({
              value: { revision: loadedState.state.revision, task: existing },
              changed: false,
            })
            return
          }
          if (loadedState.state.count >= MAX_THREAD_TASK_ITEMS) {
            throw new Error(`Agent 任务不能超过 ${MAX_THREAD_TASK_ITEMS} 项`)
          }
          const state = loadedState.state
          const nodeRequest = nodeStore.get(threadId)
          nodeRequest.onsuccess = () => {
            try {
              const node = nodeRequest.result as Node | undefined
              if (!node || node.kind !== "thread" || node.deletedAt != null) {
                throw new Error("对话不存在或已删除，无法登记 Agent task")
              }
              const now = Date.now()
              const task: ThreadTask = {
                id: threadId,
                workspaceId,
                status: "active",
                starred: false,
                createdAt: now,
                updatedAt: now,
              }
              const nextState = bumpedState(state, {
                count: state.count + 1,
              })
              taskStore.put(taskRow(task))
              taskStore.put(nextState)
              setResult({
                value: { revision: nextState.revision, task },
                changed: true,
              })
            } catch (error) {
              abort(error)
            }
          }
        } catch (error) {
          abort(error)
        }
      }

      taskRequest.onsuccess = () => {
        existing = readTask(taskRequest.result, threadId)
        taskLoaded = true
        finish()
      }
      loadTaskState(
        taskStore,
        (loaded) => {
          loadedState = loaded
          finish()
        },
        abort,
      )
    },
  )
  if (outcome.changed) notifyFilesUpdated({ kind: "thread", id: threadId })
  return outcome.value
}

/** 更新 task 轻元数据；相同值且未 touch 时是无 revision 的幂等 no-op。 */
export async function updateThreadTask(
  id: string,
  patch: ThreadTaskPatch,
): Promise<ThreadTaskMutation> {
  validatePatch(patch)
  const outcome = await idbRunTransaction<TransactionOutcome<ThreadTaskMutation>>(
    [STORE_AGENT_TASKS],
    "readwrite",
    (transaction, setResult, abort) => {
      const store = transaction.objectStore(STORE_AGENT_TASKS)
      const taskRequest = store.get(taskKey(id))
      let loadedState: LoadedTaskState | undefined
      let taskLoaded = false
      let current: ThreadTask | undefined

      const finish = () => {
        if (!loadedState || !taskLoaded) return
        try {
          if (!current) {
            if (loadedState.repaired) store.put(loadedState.state)
            setResult({ value: { revision: loadedState.state.revision }, changed: false })
            return
          }
          const changed =
            patch.touch === true ||
            (patch.status !== undefined && patch.status !== current.status) ||
            (patch.starred !== undefined && patch.starred !== current.starred)
          if (!changed) {
            if (loadedState.repaired) store.put(loadedState.state)
            setResult({
              value: { revision: loadedState.state.revision, task: current },
              changed: false,
            })
            return
          }
          const task: ThreadTask = {
            ...current,
            ...(patch.status !== undefined ? { status: patch.status } : {}),
            ...(patch.starred !== undefined ? { starred: patch.starred } : {}),
            updatedAt: nextUpdatedAt(current.updatedAt),
          }
          const nextState = bumpedState(loadedState.state)
          store.put(taskRow(task))
          store.put(nextState)
          setResult({ value: { revision: nextState.revision, task }, changed: true })
        } catch (error) {
          abort(error)
        }
      }

      taskRequest.onsuccess = () => {
        current = readTask(taskRequest.result, id)
        taskLoaded = true
        finish()
      }
      loadTaskState(
        store,
        (loaded) => {
          loadedState = loaded
          finish()
        },
        abort,
      )
    },
  )
  if (outcome.changed) notifyFilesUpdated({ kind: "thread", id })
  return outcome.value
}

/**
 * 软删 thread 并移除 task。回收站正文快照、node tombstone、task 删除与 revision 同事务提交。
 */
export type ThreadDeleteMutation = ThreadTaskMutation & { deleted: boolean }

export async function deleteTaskThread(
  id: string,
  expected?: NodeMutationExpectation,
): Promise<ThreadDeleteMutation> {
  const outcome = await idbRunTransaction<TransactionOutcome<ThreadDeleteMutation>>(
    [STORE_AGENT_TASKS, STORE_NODES, STORE_TRASH_SNAPSHOTS],
    "readwrite",
    (transaction, setResult, abort) => {
      const taskStore = transaction.objectStore(STORE_AGENT_TASKS)
      const nodeStore = transaction.objectStore(STORE_NODES)
      const taskRequest = taskStore.get(taskKey(id))
      const nodeRequest = nodeStore.get(id)
      let loadedState: LoadedTaskState | undefined
      let taskLoaded = false
      let task: ThreadTask | undefined
      let nodeLoaded = false
      let node: Node | undefined

      const finish = () => {
        if (!loadedState || !taskLoaded || !nodeLoaded) return
        try {
          assertNodeMutationExpectation(node, expected)
          let nodeChanged = false
          if (node?.kind === "thread" && node.deletedAt == null) {
            const now = Date.now()
            const snapshot: TrashSnapshot = { id, node, capturedAt: now }
            transaction.objectStore(STORE_TRASH_SNAPSHOTS).put(snapshot)
            nodeStore.put({
              ...node,
              deletedAt: now,
              updatedAt: nextUpdatedAt(node.updatedAt, now),
            } satisfies ThreadNode)
            nodeChanged = true
          }

          let revision = loadedState.state.revision
          if (task) {
            if (loadedState.state.count < 1) {
              throw new Error("Agent task count 与任务行不一致")
            }
            const nextState = bumpedState(loadedState.state, {
              count: loadedState.state.count - 1,
            })
            revision = nextState.revision
            taskStore.delete(taskKey(id))
            taskStore.put(nextState)
          } else if (loadedState.repaired) {
            taskStore.put(loadedState.state)
          }
          setResult({
            value: { revision, deleted: nodeChanged },
            changed: nodeChanged || Boolean(task),
          })
        } catch (error) {
          abort(error)
        }
      }

      taskRequest.onsuccess = () => {
        task = readTask(taskRequest.result, id)
        taskLoaded = true
        finish()
      }
      nodeRequest.onsuccess = () => {
        node = nodeRequest.result as Node | undefined
        nodeLoaded = true
        finish()
      }
      loadTaskState(
        taskStore,
        (loaded) => {
          loadedState = loaded
          finish()
        },
        abort,
      )
    },
  )
  if (outcome.changed) notifyFilesUpdated({ kind: "thread", id })
  return outcome.value
}

/**
 * 原子替换完整 task 索引。expectedRevision 在事务内比较；所有引用必须指向 live thread，
 * 任一无效都会 abort 整次替换。
 */
export async function replaceThreadTasks(
  values: readonly ThreadTask[],
  expectedRevision?: number,
): Promise<ThreadTaskSnapshot> {
  if (values.length > MAX_THREAD_TASK_ITEMS) {
    throw new Error(`Agent 任务不能超过 ${MAX_THREAD_TASK_ITEMS} 项`)
  }
  if (
    expectedRevision !== undefined &&
    (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
  ) {
    throw new Error("expectedRevision 必须是非负安全整数")
  }
  const tasks = values.map(validateTask)
  const ids = new Set<string>()
  for (const task of tasks) {
    if (ids.has(task.id)) throw new Error(`Agent task id 重复: ${task.id}`)
    ids.add(task.id)
  }

  const outcome = await idbRunTransaction<TransactionOutcome<ThreadTaskSnapshot>>(
    [STORE_AGENT_TASKS, STORE_NODES],
    "readwrite",
    (transaction, setResult, abort) => {
      const taskStore = transaction.objectStore(STORE_AGENT_TASKS)
      const nodeStore = transaction.objectStore(STORE_NODES)
      const rowsRequest = taskStore.getAll()
      const deletedRequest = nodeStore.index(INDEX_NODES_DELETED_AT).getAllKeys()
      let rows: unknown[] | undefined
      let metadataKeys: IDBValidKey[] | undefined
      let deletedKeys: IDBValidKey[] | undefined

      const finish = () => {
        if (!rows || !metadataKeys || !deletedKeys) return
        try {
          const current = readTasks(rows)
          const rawState = stateValue(rows)
          const state = {
            ...readStateValue(rawState, current.length),
            count: current.length,
          }
          if (expectedRevision !== undefined && expectedRevision !== state.revision) {
            throw new ThreadTaskConflictError()
          }
          const liveIds = liveThreadIds(metadataKeys, deletedKeys)
          const dangling = tasks.find((task) => !liveIds.has(task.id))
          if (dangling) {
            throw new Error(`Agent task 引用的对话不存在或已删除: ${dangling.id}`)
          }
          if (sameTasks(current, tasks)) {
            if (
              !hasStoredCount(rawState) ||
              (rawState as Record<string, unknown>).count !== current.length
            ) {
              taskStore.put(state)
            }
            setResult({
              value: { revision: state.revision, tasks: sortTasks(tasks) },
              changed: false,
            })
            return
          }

          const nextState = bumpedState(state, { count: tasks.length })
          taskStore.clear()
          taskStore.put(nextState)
          for (const task of tasks) taskStore.put(taskRow(task))
          setResult({
            value: { revision: nextState.revision, tasks: sortTasks(tasks) },
            changed: true,
          })
        } catch (error) {
          abort(error)
        }
      }

      rowsRequest.onsuccess = () => {
        rows = rowsRequest.result as unknown[]
        finish()
      }
      collectIndexKeys(nodeStore.index(INDEX_NODES_THREAD_METADATA), (keys) => {
        metadataKeys = keys
        finish()
      })
      deletedRequest.onsuccess = () => {
        deletedKeys = deletedRequest.result
        finish()
      }
    },
  )
  if (outcome.changed) notifyFilesUpdated({ kind: "thread" })
  return outcome.value
}

type ThreadNodeWrite = {
  title?: string
  messages?: unknown[]
}

type ThreadNodeWriteResult = {
  node: ThreadNode
  revision: number
  task?: ThreadTask
}

/**
 * 在 thread/task 共享事务内对 fresh node 应用字段补丁。expected 不匹配时整体冲突；
 * missing/tombstone 返回 undefined，不修改 task 或通知。
 */
async function writeThreadAndTouchTaskAtomic(
  id: string,
  patch: ThreadNodeWrite,
  expected?: NodeMutationExpectation,
): Promise<ThreadNodeWriteResult | undefined> {
  if (patch.messages !== undefined && !Array.isArray(patch.messages)) {
    throw new Error("对话 messages 必须是数组")
  }
  const hasFields = patch.title !== undefined || patch.messages !== undefined
  const outcome = await idbRunTransaction<TransactionOutcome<ThreadNodeWriteResult | undefined>>(
    [STORE_AGENT_TASKS, STORE_NODES],
    "readwrite",
    (transaction, setResult, abort) => {
      const taskStore = transaction.objectStore(STORE_AGENT_TASKS)
      const nodeStore = transaction.objectStore(STORE_NODES)
      const taskRequest = taskStore.get(taskKey(id))
      const nodeRequest = nodeStore.get(id)
      let loadedState: LoadedTaskState | undefined
      let taskLoaded = false
      let currentTask: ThreadTask | undefined
      let nodeLoaded = false
      let node: Node | undefined

      const finish = () => {
        if (!loadedState || !taskLoaded || !nodeLoaded) return
        try {
          assertNodeMutationExpectation(node, expected)
          if (!node || node.kind !== "thread" || node.deletedAt != null) {
            if (loadedState.repaired) taskStore.put(loadedState.state)
            setResult({ value: undefined, changed: false })
            return
          }
          if (!hasFields) {
            if (loadedState.repaired) taskStore.put(loadedState.state)
            setResult({
              value: {
                node,
                revision: loadedState.state.revision,
                ...(currentTask ? { task: currentTask } : {}),
              },
              changed: false,
            })
            return
          }

          const current = nodeToThread(node)
          const updatedAt = nextUpdatedAt(Math.max(node.updatedAt, currentTask?.updatedAt ?? 0))
          const updatedNode = threadToNode(
            {
              ...current,
              ...(patch.title !== undefined ? { title: patch.title } : {}),
              ...(patch.messages !== undefined ? { messages: patch.messages } : {}),
            },
            node,
            updatedAt,
          )
          nodeStore.put(updatedNode)

          if (!currentTask) {
            if (loadedState.repaired) taskStore.put(loadedState.state)
            setResult({
              value: { node: updatedNode, revision: loadedState.state.revision },
              changed: true,
            })
            return
          }
          const task = { ...currentTask, updatedAt }
          const nextState = bumpedState(loadedState.state)
          taskStore.put(taskRow(task))
          taskStore.put(nextState)
          setResult({
            value: { node: updatedNode, revision: nextState.revision, task },
            changed: true,
          })
        } catch (error) {
          abort(error)
        }
      }

      taskRequest.onsuccess = () => {
        currentTask = readTask(taskRequest.result, id)
        taskLoaded = true
        finish()
      }
      nodeRequest.onsuccess = () => {
        node = nodeRequest.result as Node | undefined
        nodeLoaded = true
        finish()
      }
      loadTaskState(
        taskStore,
        (loaded) => {
          loadedState = loaded
          finish()
        },
        abort,
      )
    },
  )
  if (outcome.changed) notifyFilesUpdated({ kind: "thread", id })
  return outcome.value
}

/** FileSystem 字段级 thread 写入：返回事务实际提交的 Node。 */
export async function updateThreadNodeAndTouchTaskAtomic(
  id: string,
  patch: ThreadNodeWrite,
  expected?: NodeMutationExpectation,
): Promise<ThreadNode | undefined> {
  return (await writeThreadAndTouchTaskAtomic(id, patch, expected))?.node
}

/**
 * 写回完整 live thread 并同步刷新其 task 排序时间。两行共享同一严格递增
 * updatedAt；无 task 时只提交 node，不改变 task revision。
 */
export async function saveThreadAndTouchTaskAtomic(
  thread: Thread,
  expected?: NodeMutationExpectation,
): Promise<{ thread: Thread; revision: number; task?: ThreadTask }> {
  const value = await writeThreadAndTouchTaskAtomic(
    thread.id,
    { title: thread.title, messages: thread.messages },
    expected,
  )
  if (!value) throw new Error("对话不存在或已删除，无法保存")
  return {
    thread: nodeToThread(value.node),
    revision: value.revision,
    ...(value.task ? { task: value.task } : {}),
  }
}
