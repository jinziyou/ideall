"use client"

import * as React from "react"
import {
  Bookmark,
  FileText,
  Folder,
  Link2,
  Loader2,
  RefreshCw,
  RotateCcw,
  Rss,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/ui/button"
import { EmptyState } from "@/ui/empty-state"
import { formatBytes, formatTimestamp } from "@/lib/format"
import { FileTypeIcon } from "@/shared/file-type-icon"
import {
  emptyTrash,
  listTrashItems,
  purgeTrashItem,
  restoreTrashItem,
  type TrashItem,
} from "@/files/stores/trash-store"
import { refreshSidebarTree } from "@/workspace/tree/sidebar-tree-bus"

const KIND_LABEL: Record<TrashItem["kind"], string> = {
  note: "笔记",
  bookmark: "书签",
  folder: "收藏夹",
  file: "文件",
  feed: "关注",
}

function KindIcon({ item }: { item: TrashItem }) {
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
            : Bookmark
  return <Icon className="h-4 w-4 text-muted-foreground" />
}

export default function TrashPage() {
  const [items, setItems] = React.useState<TrashItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [emptying, setEmptying] = React.useState(false)

  const refresh = React.useCallback(() => {
    setLoading(true)
    listTrashItems()
      .then(setItems)
      .catch((error) => {
        setItems([])
        toast.error("读取回收站失败", { description: String(error) })
      })
      .finally(() => setLoading(false))
  }, [])

  React.useEffect(() => {
    refresh()
  }, [refresh])

  async function restore(item: TrashItem) {
    setBusyId(item.id)
    try {
      await restoreTrashItem(item.id)
      toast.success(`已恢复「${item.title}」`)
      refreshSidebarTree()
      refresh()
    } catch (error) {
      toast.error("恢复失败", {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusyId(null)
    }
  }

  async function purge(item: TrashItem) {
    const ok = window.confirm(`永久删除「${item.title}」？此操作不可恢复。`)
    if (!ok) return
    setBusyId(item.id)
    try {
      await purgeTrashItem(item.id)
      toast.success("已永久删除")
      refreshSidebarTree()
      refresh()
    } catch (error) {
      toast.error("永久删除失败", { description: String(error) })
    } finally {
      setBusyId(null)
    }
  }

  async function clearAll() {
    if (items.length === 0) return
    const ok = window.confirm(`清空回收站中的 ${items.length} 项？此操作不可恢复。`)
    if (!ok) return
    setEmptying(true)
    try {
      const count = await emptyTrash()
      toast.success(`已清空 ${count} 项`)
      refreshSidebarTree()
      refresh()
    } catch (error) {
      toast.error("清空失败", { description: String(error) })
    } finally {
      setEmptying(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
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
            onClick={() => void clearAll()}
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
                <div key={item.id} className="flex flex-wrap items-center gap-3 p-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/40">
                    <KindIcon item={item} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="min-w-0 truncate text-sm font-medium">{item.title}</p>
                      <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {KIND_LABEL[item.kind]}
                      </span>
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
                      onClick={() => void purge(item)}
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
