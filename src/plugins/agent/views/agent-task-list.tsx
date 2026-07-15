"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight, ListTodo } from "lucide-react"
import {
  fileRefKey,
  isFileRef,
  sameFileRef,
  type DirectoryEntry,
  type FileRef,
  type IdeallFile,
} from "@protocol/file-system"
import { AGENT_TASKS_FILE_REF, AGENT_WORKSPACES_FILE_REF } from "@/filesystem/builtin-app-roots"
import {
  getFileSystemRevision,
  statFiles,
  subscribeFileSystems,
  watchFile,
} from "@/filesystem/registry"
import { corePlaceRef } from "@/filesystem/resource-file-system"
import type {
  FileSystemAccessContext,
  FileSystemWatchEvent,
  FileSystemWatchHandle,
} from "@/filesystem/types"
import { getUiActions } from "@/lib/ui-actions"
import { useFileDocument } from "@/shared/use-file-document"
import { usePagedDirectory } from "@/shared/use-paged-directory"
import { Button } from "@/ui/button"
import { Chip } from "@/ui/chip"
import { EmptyState } from "@/ui/empty-state"
import {
  decodeAgentWorkspacesDocument,
  MAX_AGENT_MANAGEMENT_STRING_LENGTH,
  MAX_AGENT_TASK_ITEMS,
  type AgentTaskStatus,
  type AgentWorkspaceSummary,
} from "../agent-management-file-contract"
import { AiPage, ListRow } from "./ui-kit"

export interface AgentTaskListItem {
  id: string
  threadRef: FileRef
  workspaceId: string
  workspaceName: string
  workspaceAvailable: boolean
  status: AgentTaskStatus
  updatedAt: number
}

const TASK_STATUSES = new Set<AgentTaskStatus>(["active", "running", "done", "failed"])

function requiredTaskEntryString(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > MAX_AGENT_MANAGEMENT_STRING_LENGTH
  ) {
    throw new Error(`${label} must be a bounded non-empty string`)
  }
  return value
}

/** 将任务目录页的开放 properties 严格收窄为 Display 所需公开字段。 */
export function decodeAgentTaskDirectoryEntry(entry: DirectoryEntry): Readonly<{
  id: string
  threadRef: FileRef
  workspaceId: string
  status: AgentTaskStatus
  updatedAt: number
}> {
  if (entry.kind !== "link" || !isFileRef(entry.target)) {
    throw new Error("Agent task directory entry must link to a thread FileRef")
  }
  if (
    !entry.properties ||
    typeof entry.properties !== "object" ||
    Array.isArray(entry.properties)
  ) {
    throw new Error("Agent task directory entry properties are missing")
  }
  const id = requiredTaskEntryString(entry.properties.taskId, "taskId")
  if (id !== entry.entryId) throw new Error("Agent task directory identity is inconsistent")
  const workspaceId = requiredTaskEntryString(entry.properties.workspaceId, "workspaceId")
  const status = entry.properties.status
  if (typeof status !== "string" || !TASK_STATUSES.has(status as AgentTaskStatus)) {
    throw new Error("Agent task directory status is invalid")
  }
  const updatedAt = entry.properties.updatedAt
  if (typeof updatedAt !== "number" || !Number.isSafeInteger(updatedAt) || updatedAt < 0) {
    throw new Error("Agent task directory updatedAt is invalid")
  }
  return { id, threadRef: entry.target, workspaceId, status: status as AgentTaskStatus, updatedAt }
}

/** 将当前目录页与工作空间安全地合并为列表行；页序由 provider cursor 投影负责。 */
export function buildAgentTaskListItems(
  entries: readonly DirectoryEntry[],
  workspaces: readonly AgentWorkspaceSummary[],
): AgentTaskListItem[] {
  const workspacesById = new Map(workspaces.map((workspace) => [workspace.id, workspace]))

  return entries.map((entry) => {
    const task = decodeAgentTaskDirectoryEntry(entry)
    const workspace = workspacesById.get(task.workspaceId)
    return {
      id: task.id,
      threadRef: task.threadRef,
      workspaceId: task.workspaceId,
      workspaceName: workspace?.name ?? "空间已删除",
      workspaceAvailable: Boolean(workspace),
      status: task.status,
      updatedAt: task.updatedAt,
    }
  })
}

const TASK_STATUS_META: Record<AgentTaskStatus, { label: string; dot: string }> = {
  active: { label: "进行中", dot: "bg-muted-foreground/60" },
  running: { label: "运行中", dot: "bg-warning" },
  done: { label: "已完成", dot: "bg-success" },
  failed: { label: "失败", dot: "bg-destructive" },
}

const STATUS_TONE: Record<AgentTaskStatus, "idle" | "warn" | "ok" | "error"> = {
  active: "idle",
  running: "warn",
  done: "ok",
  failed: "error",
}

const EMPTY_WORKSPACES: readonly AgentWorkspaceSummary[] = []
const EMPTY_TASK_ENTRIES: readonly DirectoryEntry[] = []
export const AGENT_TASK_PAGE_SIZE = 64
const MAX_AGENT_TASK_PAGES = Math.ceil(MAX_AGENT_TASK_ITEMS / AGENT_TASK_PAGE_SIZE)

const UI_METADATA_CONTEXT = {
  actor: "ui",
  permissions: [],
  intent: "metadata",
} as const satisfies FileSystemAccessContext

const UI_WATCH_CONTEXT = {
  actor: "ui",
  permissions: [],
  intent: "watch",
} as const satisfies FileSystemAccessContext

export function threadTitleFromFile(file: IdeallFile | null, expectedRef: FileRef): string | null {
  if (
    !file ||
    !sameFileRef(file.ref, expectedRef) ||
    file.kind !== "file" ||
    file.properties?.resourceKind !== "thread"
  ) {
    return null
  }
  return file.name.trim() || "未命名任务"
}

export const AGENT_THREAD_COLLECTION_REF = corePlaceRef("home")

export function threadFileRefsForItems(items: readonly AgentTaskListItem[]): FileRef[] {
  const refs = new Map<string, FileRef>()
  for (const item of items) {
    refs.set(fileRefKey(item.threadRef), item.threadRef)
  }
  return [...refs.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, ref]) => ref)
}

export function threadTitlesFromFiles(
  refs: readonly FileRef[],
  files: readonly (IdeallFile | null)[],
): ReadonlyMap<string, string | null> {
  return new Map(
    refs.map((ref, index) => [fileRefKey(ref), threadTitleFromFile(files[index] ?? null, ref)]),
  )
}

export type ThreadMetadataBatchGateway = Readonly<{
  stat(refs: readonly FileRef[]): Promise<Array<IdeallFile | null>>
  watch(ref: FileRef, notify: (event: FileSystemWatchEvent) => void): FileSystemWatchHandle | null
}>

export type ThreadMetadataBatchOutcome =
  | Readonly<{
      status: "success"
      titles: ReadonlyMap<string, string | null>
      /** full 替换当前页快照；patch 只合并精确 watch 命中的线程。 */
      mode: "full" | "patch"
    }>
  | Readonly<{ status: "error" }>

export type ThreadMetadataState = Readonly<{
  titles: ReadonlyMap<string, string | null>
  loadingKeys: ReadonlySet<string>
}>

export function prepareThreadMetadataState(
  previous: ThreadMetadataState,
  refs: readonly FileRef[],
): ThreadMetadataState {
  const refKeys = new Set(refs.map(fileRefKey))
  const titles = new Map([...previous.titles].filter(([key]) => refKeys.has(key)))
  const loadingKeys = new Set([...refKeys].filter((key) => !titles.has(key)))
  return { titles, loadingKeys }
}

export function applyThreadMetadataOutcome(
  previous: ThreadMetadataState,
  outcome: ThreadMetadataBatchOutcome,
): ThreadMetadataState {
  if (outcome.status === "error") return { ...previous, loadingKeys: new Set() }
  if (outcome.mode === "full") return { titles: outcome.titles, loadingKeys: new Set() }
  const titles = new Map(previous.titles)
  for (const [key, title] of outcome.titles) titles.set(key, title)
  const loadingKeys = new Set(previous.loadingKeys)
  for (const key of outcome.titles.keys()) loadingKeys.delete(key)
  return { titles, loadingKeys }
}

const registryThreadMetadataGateway: ThreadMetadataBatchGateway = {
  stat: (refs) => statFiles(refs, UI_METADATA_CONTEXT),
  watch: (ref, notify) => watchFile(ref, UI_WATCH_CONTEXT, notify),
}

/**
 * 一个可见任务页只建一个 controller：首次读取整页 statMany；collection watch 带精确
 * changes 时只刷新命中项，缺少明细才回退整页。同步事件风暴与 in-flight 尾刷新均合并。
 */
export class ThreadMetadataBatchController {
  readonly #refs: readonly FileRef[]
  readonly #refsByKey: ReadonlyMap<string, FileRef>
  readonly #gateway: ThreadMetadataBatchGateway
  readonly #publish: (outcome: ThreadMetadataBatchOutcome) => void
  #active = false
  #request = 0
  #inFlight: Promise<void> | null = null
  #fullRefreshQueued = false
  #changedKeys = new Set<string>()
  #microtaskQueued = false
  #watch: FileSystemWatchHandle | null = null

  constructor(
    refs: readonly FileRef[],
    publish: (outcome: ThreadMetadataBatchOutcome) => void,
    gateway: ThreadMetadataBatchGateway = registryThreadMetadataGateway,
  ) {
    const unique = new Map(refs.map((ref) => [fileRefKey(ref), ref]))
    const entries = [...unique.entries()].sort(([left], [right]) => left.localeCompare(right))
    this.#refs = entries.map(([, ref]) => ref)
    this.#refsByKey = new Map(entries)
    this.#gateway = gateway
    this.#publish = publish
  }

  start(): Promise<void> {
    if (this.#active) return this.#inFlight ?? Promise.resolve()
    this.#active = true
    if (this.#refs.length === 0) {
      this.#publish({ status: "success", titles: new Map(), mode: "full" })
      return Promise.resolve()
    }
    const initial = this.#refresh(this.#refs, "full")
    try {
      this.#watch = this.#gateway.watch(AGENT_THREAD_COLLECTION_REF, (event) =>
        this.#handleWatch(event),
      )
    } catch {
      // provider 未挂载时由 registry revision 重建 controller；批量 metadata 读取仍可完成。
    }
    return initial
  }

  dispose(): void {
    if (!this.#active) return
    this.#active = false
    this.#request += 1
    this.#fullRefreshQueued = false
    this.#changedKeys.clear()
    this.#microtaskQueued = false
    const watch = this.#watch
    this.#watch = null
    try {
      watch?.dispose()
    } catch {
      // 卸载为 best-effort；旧 controller 的 request token 已先失效。
    }
  }

  #handleWatch(event: FileSystemWatchEvent): void {
    const changes = event && Array.isArray(event.changes) ? event.changes : null
    if (!changes || changes.length === 0) {
      this.#queueFullRefresh()
      return
    }
    const changedKeys = new Set<string>()
    for (const change of changes) {
      if (!change || typeof change !== "object" || !isFileRef(change.ref)) {
        this.#queueFullRefresh()
        return
      }
      const key = fileRefKey(change.ref)
      if (this.#refsByKey.has(key)) changedKeys.add(key)
    }
    if (changedKeys.size === 0) return
    for (const key of changedKeys) this.#changedKeys.add(key)
    this.#scheduleFlush()
  }

  #queueFullRefresh(): void {
    this.#fullRefreshQueued = true
    this.#changedKeys.clear()
    this.#scheduleFlush()
  }

  #scheduleFlush(): void {
    if (!this.#active || this.#microtaskQueued) return
    this.#microtaskQueued = true
    queueMicrotask(() => {
      this.#microtaskQueued = false
      if (!this.#active) return
      if (this.#inFlight) return
      if (this.#fullRefreshQueued) {
        this.#fullRefreshQueued = false
        this.#changedKeys.clear()
        void this.#refresh(this.#refs, "full")
        return
      }
      if (this.#changedKeys.size === 0) return
      const refs = [...this.#changedKeys]
        .sort((left, right) => left.localeCompare(right))
        .flatMap((key) => {
          const ref = this.#refsByKey.get(key)
          return ref ? [ref] : []
        })
      this.#changedKeys.clear()
      if (refs.length > 0) void this.#refresh(refs, "patch")
    })
  }

  #refresh(refs: readonly FileRef[], mode: "full" | "patch"): Promise<void> {
    if (!this.#active || refs.length === 0) return Promise.resolve()
    if (this.#inFlight) throw new Error("Thread metadata refreshes must be serialized")
    const request = ++this.#request
    let stat: Promise<Array<IdeallFile | null>>
    try {
      stat = this.#gateway.stat(refs)
    } catch (error) {
      stat = Promise.reject(error)
    }
    const pending = stat
      .then((files) => {
        if (
          files.length !== refs.length ||
          refs.some(
            (_ref, index) =>
              !Object.prototype.hasOwnProperty.call(files, index) || files[index] === undefined,
          )
        ) {
          throw new Error("Thread metadata batch result does not align with requested refs")
        }
        if (this.#active && request === this.#request) {
          this.#publish({
            status: "success",
            titles: threadTitlesFromFiles(refs, files),
            mode,
          })
        }
      })
      .catch(() => {
        if (this.#active && request === this.#request) {
          this.#publish({ status: "error" })
        }
      })
      .finally(() => {
        if (this.#inFlight === pending) this.#inFlight = null
        if (this.#active && (this.#fullRefreshQueued || this.#changedKeys.size > 0)) {
          this.#scheduleFlush()
        }
      })
    this.#inFlight = pending
    return pending
  }
}

function useThreadFileTitles(refs: readonly FileRef[]): {
  titles: ReadonlyMap<string, string | null>
  loadingKeys: ReadonlySet<string>
} {
  const [state, setState] = React.useState<{
    titles: ReadonlyMap<string, string | null>
    loadingKeys: ReadonlySet<string>
  }>({ titles: new Map(), loadingKeys: new Set(refs.map(fileRefKey)) })
  const registryRevision = React.useSyncExternalStore(
    subscribeFileSystems,
    getFileSystemRevision,
    () => 0,
  )

  React.useEffect(() => {
    const controller = new ThreadMetadataBatchController(refs, (outcome) => {
      // 瞬时 metadata 故障保留 last-good 标题；首次失败则清掉 loading，显示不可用。
      setState((previous) => applyThreadMetadataOutcome(previous, outcome))
    })
    setState((previous) => prepareThreadMetadataState(previous, refs))
    void controller.start()
    return () => controller.dispose()
  }, [refs, registryRevision])

  return state
}

function AgentTaskRow({
  item,
  workspace,
  threadTitle,
  threadLoading,
}: {
  item: AgentTaskListItem
  workspace: AgentWorkspaceSummary | undefined
  threadTitle: string | null | undefined
  threadLoading: boolean
}) {
  const title = threadTitle ?? (threadLoading ? "正在读取任务…" : "对话不可用")
  const status = TASK_STATUS_META[item.status]

  return (
    <ListRow
      leading={<span className={`h-2 w-2 rounded-full ${status.dot}`} />}
      title={title}
      subtitle={`所属空间：${item.workspaceName}`}
      onClick={
        workspace ? () => getUiActions()?.openAiTasks?.(workspace.id, workspace.name) : undefined
      }
      trailing={<Chip tone={STATUS_TONE[item.status]}>{status.label}</Chip>}
    />
  )
}

export default function AgentTaskList({ fileRef = AGENT_TASKS_FILE_REF }: { fileRef?: FileRef }) {
  const directory = usePagedDirectory(fileRef, {
    pageSize: AGENT_TASK_PAGE_SIZE,
    maxPages: MAX_AGENT_TASK_PAGES,
    maxEntries: MAX_AGENT_TASK_ITEMS,
  })
  const workspacesDocument = useFileDocument(
    AGENT_WORKSPACES_FILE_REF,
    decodeAgentWorkspacesDocument,
  )
  const workspaces = workspacesDocument.data?.workspaces ?? EMPTY_WORKSPACES
  const [pageSelection, setPageSelection] = React.useState({
    resetVersion: directory.resetVersion,
    index: 0,
  })
  const pageIndex =
    pageSelection.resetVersion === directory.resetVersion &&
    pageSelection.index < directory.pages.length
      ? pageSelection.index
      : 0
  const currentEntries = directory.pages[pageIndex]?.entries ?? EMPTY_TASK_ENTRIES

  const itemProjection = React.useMemo(() => {
    try {
      return { items: buildAgentTaskListItems(currentEntries, workspaces), error: null }
    } catch (error) {
      return { items: [] as AgentTaskListItem[], error }
    }
  }, [currentEntries, workspaces])
  const items = itemProjection.items
  const workspacesById = React.useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.id, workspace])),
    [workspaces],
  )
  const threadRefs = React.useMemo(() => threadFileRefsForItems(items), [items])
  const threadMetadata = useThreadFileTitles(threadRefs)
  const loading =
    (directory.loading && directory.pages.length === 0) ||
    (workspacesDocument.loading && !workspacesDocument.data)
  const hasCachedNextPage = pageIndex + 1 < directory.pages.length
  const canGoNext = hasCachedNextPage || directory.nextCursor !== undefined

  function goToPreviousPage(): void {
    if (pageIndex === 0) return
    setPageSelection({ resetVersion: directory.resetVersion, index: pageIndex - 1 })
  }

  async function goToNextPage(): Promise<void> {
    if (directory.loading || directory.loadingMore) return
    if (hasCachedNextPage) {
      setPageSelection({ resetVersion: directory.resetVersion, index: pageIndex + 1 })
      return
    }
    if (directory.nextCursor === undefined) return
    const resetVersion = directory.resetVersion
    if (await directory.loadMore()) {
      setPageSelection({ resetVersion, index: pageIndex + 1 })
    }
  }

  function retryDirectory(): void {
    if (directory.nextCursor !== undefined && !directory.loading) {
      void goToNextPage()
      return
    }
    void directory.reset()
  }

  return (
    <AiPage title="任务" icon={ListTodo}>
      {loading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">正在读取任务…</p>
      ) : directory.error && directory.pages.length === 0 ? (
        <EmptyState
          icon={ListTodo}
          title="任务读取失败"
          description="文件系统暂不可用，请稍后重试。"
          variant="halo"
          bordered={false}
          action={
            <Button type="button" variant="outline" size="sm" onClick={retryDirectory}>
              重试
            </Button>
          }
        />
      ) : itemProjection.error ? (
        <EmptyState
          icon={ListTodo}
          title="任务索引无效"
          description="文件系统返回了无法识别的任务目录项，请刷新后重试。"
          variant="halo"
          bordered={false}
        />
      ) : workspacesDocument.error && !workspacesDocument.data ? (
        <EmptyState
          icon={ListTodo}
          title="空间索引读取失败"
          description="暂时无法确认任务所属空间，请稍后重试。"
          variant="halo"
          bordered={false}
        />
      ) : currentEntries.length === 0 && pageIndex === 0 && directory.nextCursor === undefined ? (
        <EmptyState
          icon={ListTodo}
          title="还没有任务"
          description="进入一个空间并开始对话后，任务会汇总在这里。"
          variant="halo"
          bordered={false}
        />
      ) : (
        <div className="space-y-4">
          {Boolean(directory.error) && (
            <div
              role="alert"
              className="flex items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/5 px-4 py-3 text-sm"
            >
              <span className="text-muted-foreground">
                任务目录刷新失败，当前显示上次成功读取的页面。
              </span>
              <Button type="button" variant="outline" size="sm" onClick={retryDirectory}>
                重试
              </Button>
            </div>
          )}
          <div className="space-y-2">
            {items.map((item) => {
              const workspace = workspacesById.get(item.workspaceId)
              const threadKey = fileRefKey(item.threadRef)
              return (
                <AgentTaskRow
                  key={item.id}
                  item={item}
                  workspace={workspace}
                  threadTitle={threadMetadata.titles.get(threadKey)}
                  threadLoading={threadMetadata.loadingKeys.has(threadKey)}
                />
              )
            })}
          </div>
          <nav className="flex items-center justify-center gap-3 pt-2" aria-label="任务分页">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pageIndex === 0 || directory.loading || directory.loadingMore}
              onClick={goToPreviousPage}
            >
              <ChevronLeft className="mr-1 h-4 w-4" aria-hidden="true" />
              上一页
            </Button>
            <span className="min-w-16 text-center text-sm text-muted-foreground" aria-live="polite">
              第 {pageIndex + 1} 页
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canGoNext || directory.loading || directory.loadingMore}
              onClick={() => void goToNextPage()}
            >
              {directory.loadingMore ? "读取中…" : "下一页"}
              <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
            </Button>
          </nav>
        </div>
      )}
    </AiPage>
  )
}
