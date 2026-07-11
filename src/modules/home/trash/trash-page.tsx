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
import { trashItemRef, trashRootRef, type TrashFileItem } from "@/filesystem/trash-file-system"
import { invokeFileAction, watchFile } from "@/filesystem/registry"
import { readCompleteDirectory } from "@/filesystem/directory-walk"

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
  note: "笔记",
  bookmark: "书签",
  folder: "收藏夹",
  file: "文件",
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

export default function TrashPage() {
  const [items, setItems] = React.useState<TrashFileItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [emptying, setEmptying] = React.useState(false)
  const [confirming, setConfirming] = React.useState<
    { kind: "purge"; item: TrashFileItem } | { kind: "empty" } | null
  >(null)

  const refresh = React.useCallback(async () => {
    setLoading(true)
    try {
      const entries = await readCompleteDirectory(trashRootRef, DIRECTORY_CONTEXT)
      setItems(entries.flatMap((entry) => parseTrashItem(entry.properties)))
    } catch (error) {
      setItems([])
      toast.error("读取回收站失败", { description: String(error) })
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void refresh()
    const handle = watchFile(trashRootRef, WATCH_CONTEXT, () => void refresh())
    return () => handle?.dispose()
  }, [refresh])

  async function restore(item: TrashFileItem) {
    setBusyId(item.id)
    try {
      await invokeFileAction(trashItemRef(item.id), "restore", undefined, ACTION_CONTEXT)
      toast.success(`已恢复「${item.title}」`)
      await refresh()
    } catch (error) {
      toast.error("恢复失败", {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusyId(null)
    }
  }

  async function purge(item: TrashFileItem) {
    setBusyId(item.id)
    try {
      await invokeFileAction(trashItemRef(item.id), "purge", undefined, ACTION_CONTEXT)
      toast.success("已永久删除")
      await refresh()
    } catch (error) {
      toast.error("永久删除失败", { description: String(error) })
    } finally {
      setBusyId(null)
    }
  }

  async function clearAll() {
    if (items.length === 0) return
    setEmptying(true)
    try {
      const result = await invokeFileAction(trashRootRef, "empty", undefined, ACTION_CONTEXT)
      const count =
        result != null && typeof result === "object" && "count" in result
          ? Number(result.count) || 0
          : 0
      toast.success(`已清空 ${count} 项`)
      await refresh()
    } catch (error) {
      toast.error("清空失败", { description: String(error) })
    } finally {
      setEmptying(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <ConfirmDialog
        open={!!confirming}
        onOpenChange={(open) => {
          if (!open) setConfirming(null)
        }}
        title={
          confirming?.kind === "purge" ? `永久删除「${confirming.item.title}」？` : "清空回收站？"
        }
        description={
          confirming?.kind === "purge"
            ? "此操作不可恢复，文件内容快照也会被移除。"
            : `将永久删除回收站中的 ${items.length} 项，此操作不可恢复。`
        }
        confirmLabel={confirming?.kind === "purge" ? "永久删除" : "清空回收站"}
        destructive
        onConfirm={() => {
          const next = confirming
          setConfirming(null)
          if (next?.kind === "purge") void purge(next.item)
          else if (next?.kind === "empty") void clearAll()
        }}
      />
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">回收站</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            管理本机已删除的文件、笔记、书签与关注。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={refresh} disabled={loading}>
            <RefreshCw className="mr-1.5 h-4 w-4" />
            刷新
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => setConfirming({ kind: "empty" })}
            disabled={items.length === 0 || emptying}
          >
            {emptying ? (
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
                      disabled={!item.restorable || busy}
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
                      disabled={busy}
                      data-testid={`trash-purge-${item.id}`}
                      onClick={() => setConfirming({ kind: "purge", item })}
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
