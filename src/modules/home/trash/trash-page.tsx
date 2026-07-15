"use client"

import * as React from "react"
import {
  Bookmark,
  FileText,
  Folder,
  Link2,
  Loader2,
  MessageSquare,
  RefreshCw,
  RotateCcw,
  Rss,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/ui/button"
import { EmptyState } from "@/ui/empty-state"
import { ConfirmDialog } from "@/shared/prompt-dialog"
import { formatBytes, formatTimestamp } from "@/lib/format"
import { FileTypeBadge, FileTypeIcon } from "@/shared/file-type-icon"
import { fileRefKey, type FileRef } from "@protocol/file-system"
import { trashItemRef, trashRootRef, type TrashFileItem } from "@/filesystem/trash-file-system"
import { invokeFileAction, watchFile } from "@/filesystem/registry"
import { readCompleteDirectory } from "@/filesystem/directory-walk"
import {
  createTrashEmptyConfirmationRequestGate,
  prepareTrashEmptyConfirmation,
  type TrashEmptyConfirmation,
} from "./trash-empty-confirmation"
import {
  canStartTrashMutation,
  completeTrashRefresh,
  createTrashRefreshCoordinator,
  failTrashRefresh,
  runTrashRefreshRequest,
  settleTrashMutationWithRefresh,
  startTrashRefresh,
  visibleTrashRefreshView,
  type TrashRefreshTarget,
  type TrashRefreshViewState,
} from "./trash-refresh-coordinator"

const DIRECTORY_CONTEXT = { actor: "ui", permissions: [], intent: "directory" } as const
const ACTION_CONTEXT = { actor: "ui", permissions: [], intent: "action" } as const
const WATCH_CONTEXT = { actor: "ui", permissions: [], intent: "watch" } as const
const TRASH_KINDS: TrashFileItem["kind"][] = [
  "folder",
  "note",
  "bookmark",
  "file",
  "feed",
  "thread",
]

function parseTrashItem(value: Readonly<Record<string, unknown>> | undefined): TrashFileItem[] {
  if (
    !value ||
    typeof value.id !== "string" ||
    typeof value.kind !== "string" ||
    !TRASH_KINDS.includes(value.kind as TrashFileItem["kind"]) ||
    typeof value.title !== "string" ||
    typeof value.deletedAt !== "number" ||
    typeof value.updatedAt !== "number" ||
    !(value.parentId === null || typeof value.parentId === "string") ||
    !Array.isArray(value.tags) ||
    !value.tags.every((tag) => typeof tag === "string") ||
    typeof value.restorable !== "boolean" ||
    typeof value.snapshot !== "boolean" ||
    typeof value.detail !== "string"
  ) {
    return []
  }
  return [value as unknown as TrashFileItem]
}

const KIND_LABEL: Record<TrashFileItem["kind"], string> = {
  note: "页面",
  bookmark: "书签",
  folder: "收藏夹",
  file: "资源",
  feed: "关注",
  thread: "对话",
}

function KindIcon({ item }: { item: TrashFileItem }) {
  if (item.kind === "file") {
    return <FileTypeIcon name={item.title} type={item.mime} className="h-4 w-4" />
  }
  const Icon =
    item.kind === "note"
      ? FileText
      : item.kind === "bookmark"
        ? Link2
        : item.kind === "folder"
          ? Folder
          : item.kind === "feed"
            ? Rss
            : item.kind === "thread"
              ? MessageSquare
              : Bookmark
  return <Icon className="h-4 w-4 text-muted-foreground" />
}

export default function TrashPage({ rootRef = trashRootRef }: { rootRef?: FileRef } = {}) {
  const rootFileSystemId = rootRef.fileSystemId
  const rootFileId = rootRef.fileId
  const stableRootRef = React.useMemo<FileRef>(
    () => ({ fileSystemId: rootFileSystemId, fileId: rootFileId }),
    [rootFileId, rootFileSystemId],
  )
  const rootKey = fileRefKey(stableRootRef)
  const rootViewTarget = React.useMemo(() => Object.freeze({ targetKey: rootKey }), [rootKey])
  const refreshCoordinator = React.useRef(createTrashRefreshCoordinator())
  const refreshTarget = React.useRef<TrashRefreshTarget | null>(null)
  const [refreshState, setRefreshState] = React.useState<TrashRefreshViewState<TrashFileItem>>({
    target: rootViewTarget,
    items: [],
    loading: true,
  })
  const { items, loading } = visibleTrashRefreshView(refreshState, rootViewTarget)
  const mutationRequests = React.useRef(0)
  const [mutationState, setMutationState] = React.useState<{
    target: TrashRefreshTarget
    request: number
    busyId: string | null
    emptying: boolean
  } | null>(null)
  const currentMutation =
    mutationState?.target.targetKey === rootKey &&
    refreshCoordinator.current.isTargetActive(mutationState.target)
      ? mutationState
      : null
  const busyId = currentMutation?.busyId ?? null
  const emptying = currentMutation?.emptying ?? false
  const emptyConfirmationRequests = React.useRef(createTrashEmptyConfirmationRequestGate())
  const [emptyPreparation, setEmptyPreparation] = React.useState<{
    rootKey: string
    request: number
  } | null>(null)
  type Confirmation = { kind: "purge"; item: TrashFileItem } | TrashEmptyConfirmation
  const [confirmationState, setConfirmationState] = React.useState<{
    rootKey: string
    request: number
    value: Confirmation
  } | null>(null)
  const preparingEmpty =
    emptyPreparation?.rootKey === rootKey &&
    emptyConfirmationRequests.current.isCurrent(emptyPreparation.request)
  const confirming =
    confirmationState?.rootKey === rootKey &&
    emptyConfirmationRequests.current.isCurrent(confirmationState.request)
      ? confirmationState.value
      : null

  const refresh = React.useCallback(
    async (target: TrashRefreshTarget) => {
      const coordinator = refreshCoordinator.current
      await runTrashRefreshRequest(
        coordinator,
        target,
        async () => {
          const entries = await readCompleteDirectory(stableRootRef, DIRECTORY_CONTEXT)
          return entries.flatMap((entry) => parseTrashItem(entry.properties))
        },
        {
          onStart(request) {
            setRefreshState((current) =>
              coordinator.isCurrent(request) ? startTrashRefresh(current, rootViewTarget) : current,
            )
          },
          onSuccess(nextItems, request) {
            setRefreshState((current) =>
              coordinator.isCurrent(request)
                ? completeTrashRefresh(rootViewTarget, nextItems)
                : current,
            )
          },
          onError(error, request) {
            setRefreshState((current) =>
              coordinator.isCurrent(request) ? failTrashRefresh(current, rootViewTarget) : current,
            )
            toast.error("读取回收站失败", { description: String(error) })
          },
        },
      )
    },
    [rootViewTarget, stableRootRef],
  )

  React.useEffect(() => {
    const confirmationRequests = emptyConfirmationRequests.current
    const coordinator = refreshCoordinator.current
    const target = coordinator.activate(rootKey)
    refreshTarget.current = target
    void refresh(target)
    const handle = watchFile(stableRootRef, WATCH_CONTEXT, () => void refresh(target))
    return () => {
      if (refreshTarget.current?.generation === target.generation) refreshTarget.current = null
      coordinator.deactivate(target)
      confirmationRequests.cancel()
      handle?.dispose()
    }
  }, [refresh, rootKey, stableRootRef])

  function cancelEmptyConfirmationPreparation() {
    emptyConfirmationRequests.current.cancel()
    setEmptyPreparation(null)
  }

  function activeRefreshTarget(): TrashRefreshTarget | null {
    const target = refreshTarget.current
    return target && refreshCoordinator.current.isTargetActive(target) ? target : null
  }

  async function restore(item: TrashFileItem) {
    const target = activeRefreshTarget()
    if (
      !target ||
      !canStartTrashMutation("restore", {
        loading,
        mutationBusy: busyId !== null || emptying,
      })
    )
      return
    cancelEmptyConfirmationPreparation()
    const mutationRequest = ++mutationRequests.current
    setMutationState({ target, request: mutationRequest, busyId: item.id, emptying: false })
    try {
      await invokeFileAction(trashItemRef(item.id), "restore", undefined, ACTION_CONTEXT, {
        expectedVersion: String(item.updatedAt),
      })
      if (refreshCoordinator.current.isTargetActive(target)) {
        toast.success(`已恢复「${item.title}」`)
      }
    } catch (error) {
      if (refreshCoordinator.current.isTargetActive(target)) {
        toast.error("恢复失败", {
          description: error instanceof Error ? error.message : String(error),
        })
      }
    } finally {
      await settleTrashMutationWithRefresh(
        () => refresh(target),
        () => {
          if (refreshCoordinator.current.isTargetActive(target)) {
            setMutationState((current) =>
              current?.request === mutationRequest &&
              current.target.generation === target.generation
                ? null
                : current,
            )
          }
        },
      )
    }
  }

  async function purge(item: TrashFileItem) {
    const target = activeRefreshTarget()
    if (
      !target ||
      !canStartTrashMutation("purge", {
        loading,
        mutationBusy: busyId !== null || emptying,
      })
    )
      return
    const mutationRequest = ++mutationRequests.current
    setMutationState({ target, request: mutationRequest, busyId: item.id, emptying: false })
    try {
      await invokeFileAction(trashItemRef(item.id), "purge", undefined, ACTION_CONTEXT, {
        expectedVersion: String(item.updatedAt),
      })
      if (refreshCoordinator.current.isTargetActive(target)) toast.success("已永久删除")
    } catch (error) {
      if (refreshCoordinator.current.isTargetActive(target)) {
        toast.error("永久删除失败", { description: String(error) })
      }
    } finally {
      await settleTrashMutationWithRefresh(
        () => refresh(target),
        () => {
          if (refreshCoordinator.current.isTargetActive(target)) {
            setMutationState((current) =>
              current?.request === mutationRequest &&
              current.target.generation === target.generation
                ? null
                : current,
            )
          }
        },
      )
    }
  }

  async function clearAll(expectedVersion: string) {
    const target = activeRefreshTarget()
    if (
      !target ||
      !canStartTrashMutation("empty", {
        loading,
        mutationBusy: busyId !== null || emptying,
      })
    )
      return
    const mutationRequest = ++mutationRequests.current
    setMutationState({ target, request: mutationRequest, busyId: null, emptying: true })
    try {
      const result = await invokeFileAction(stableRootRef, "empty", undefined, ACTION_CONTEXT, {
        expectedVersion,
      })
      const count =
        result != null && typeof result === "object" && "count" in result
          ? Number(result.count) || 0
          : 0
      if (refreshCoordinator.current.isTargetActive(target)) {
        toast.success(`已清空 ${count} 项`)
      }
    } catch (error) {
      if (refreshCoordinator.current.isTargetActive(target)) {
        toast.error("清空失败", { description: String(error) })
      }
    } finally {
      await settleTrashMutationWithRefresh(
        () => refresh(target),
        () => {
          if (refreshCoordinator.current.isTargetActive(target)) {
            setMutationState((current) =>
              current?.request === mutationRequest &&
              current.target.generation === target.generation
                ? null
                : current,
            )
          }
        },
      )
    }
  }

  async function openEmptyConfirmation() {
    const target = activeRefreshTarget()
    if (!target || loading || items.length === 0 || busyId !== null || emptying || confirming)
      return
    const request = emptyConfirmationRequests.current.begin()
    const requestRootKey = target.targetKey
    setEmptyPreparation({ rootKey: requestRootKey, request })
    try {
      const confirmation = await prepareTrashEmptyConfirmation(items)
      if (emptyConfirmationRequests.current.isCurrent(request)) {
        setConfirmationState({ rootKey: requestRootKey, request, value: confirmation })
      }
    } catch (error) {
      if (emptyConfirmationRequests.current.isCurrent(request)) {
        toast.error("准备清空失败", { description: String(error) })
      }
    } finally {
      if (emptyConfirmationRequests.current.isCurrent(request)) setEmptyPreparation(null)
    }
  }

  function openPurgeConfirmation(item: TrashFileItem) {
    cancelEmptyConfirmationPreparation()
    if (!activeRefreshTarget() || loading || busyId !== null || emptying) return
    const request = emptyConfirmationRequests.current.begin()
    setConfirmationState({ rootKey, request, value: { kind: "purge", item } })
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <ConfirmDialog
        open={!!confirming}
        onOpenChange={(open) => {
          if (!open) {
            cancelEmptyConfirmationPreparation()
            setConfirmationState(null)
          }
        }}
        title={
          confirming?.kind === "purge" ? `永久删除「${confirming.item.title}」？` : "清空回收站？"
        }
        description={
          confirming?.kind === "purge"
            ? "此操作不可恢复，文件内容快照也会被移除。"
            : `将永久删除回收站中的 ${confirming?.count ?? 0} 项，此操作不可恢复。`
        }
        confirmLabel={confirming?.kind === "purge" ? "永久删除" : "清空回收站"}
        destructive
        onConfirm={() => {
          const next = confirming
          cancelEmptyConfirmationPreparation()
          setConfirmationState(null)
          if (next?.kind === "purge") void purge(next.item)
          else if (next?.kind === "empty") void clearAll(next.expectedVersion)
        }}
      />
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">回收站</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            管理本机已删除的页面、资源、书签与关注。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              const target = activeRefreshTarget()
              if (target) void refresh(target)
            }}
            disabled={loading}
          >
            <RefreshCw className="mr-1.5 h-4 w-4" />
            刷新
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => void openEmptyConfirmation()}
            disabled={
              loading || items.length === 0 || preparingEmpty || emptying || busyId !== null
            }
          >
            {preparingEmpty || emptying ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="mr-1.5 h-4 w-4" />
            )}
            清空
          </Button>
        </div>
      </header>

      <section className="rounded-lg border border-border/60 bg-card">
        {loading && items.length === 0 ? (
          <EmptyState icon={Loader2} title="正在读取回收站" bordered={false} />
        ) : items.length === 0 ? (
          <EmptyState icon={Trash2} title="回收站为空" bordered={false} />
        ) : (
          <div className="divide-y">
            {items.map((item) => {
              const busy = busyId === item.id
              const mutationBusy = loading || busyId !== null || emptying
              return (
                <div
                  key={item.id}
                  data-testid={`trash-item-${item.id}`}
                  className="flex flex-wrap items-center gap-3 p-3"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/40">
                    <KindIcon item={item} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="min-w-0 truncate text-sm font-medium">{item.title}</p>
                      {item.kind === "file" ? (
                        <FileTypeBadge name={item.title} type={item.mime} />
                      ) : (
                        <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {KIND_LABEL[item.kind]}
                        </span>
                      )}
                      {item.snapshot && (
                        <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-700">
                          可恢复快照
                        </span>
                      )}
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {item.detail}
                      {item.size ? ` · ${formatBytes(item.size)}` : ""}
                      {" · 删除于 "}
                      {formatTimestamp(item.deletedAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!item.restorable || mutationBusy || preparingEmpty}
                      data-testid={`trash-restore-${item.id}`}
                      onClick={() => void restore(item)}
                    >
                      {busy ? (
                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      ) : (
                        <RotateCcw className="mr-1.5 h-4 w-4" />
                      )}
                      恢复
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:text-destructive"
                      disabled={mutationBusy || preparingEmpty}
                      data-testid={`trash-purge-${item.id}`}
                      onClick={() => openPurgeConfirmation(item)}
                    >
                      <Trash2 className="mr-1.5 h-4 w-4" />
                      永久删除
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
