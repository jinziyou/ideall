"use client"

import * as React from "react"
import {
  Archive,
  Bookmark,
  CheckCircle2,
  FileDown,
  FileText,
  Highlighter,
  Image as ImageIcon,
  Import,
  Inbox,
  Loader2,
  MousePointerClick,
  PackageCheck,
} from "lucide-react"
import { toast } from "sonner"
import { corePlaceRef, resourceFileRef } from "@/filesystem/resource-file-system"
import { watchFileSet } from "@/filesystem/watch-set"
import {
  completeCaptureOnboarding,
  getCaptureOnboardingPhase,
  getServerCaptureOnboardingPhase,
  subscribeCaptureOnboarding,
} from "@/lib/capture-onboarding"
import { formatTime } from "@/lib/format"
import {
  listBookmarkFiles,
  updateBookmarkFile,
  type FileBookmark,
  type FileBookmarkFolder,
} from "@/modules/home/bookmarks/bookmark-file-system"
import {
  listNoteFiles,
  updateNoteFileTags,
  type FileNote,
} from "@/modules/home/notes/note-file-system"
import {
  loadManagedFiles,
  updateManagedFileTags,
  type ManagedFile,
} from "@/modules/home/resources/file-manager-data"
import { Button } from "@/ui/button"
import { EmptyState } from "@/ui/empty-state"
import { Panel } from "@/ui/panel"
import { useTabActive } from "@/workspace/tab-active-context"
import { openTarget } from "@/workspace/store"
import { buildCaptureInboxItems, withoutCaptureInboxTag, type CaptureInboxItem } from "./inbox-data"
import CaptureImportDialog from "./capture-import-dialog"

const WATCH_CONTEXT = { actor: "ui", permissions: [], intent: "watch" } as const
const INBOX_ROOTS = [corePlaceRef("bookmarks"), corePlaceRef("notes"), corePlaceRef("files")]

type InboxState = Readonly<{
  items: CaptureInboxItem[]
  bookmarks: FileBookmark[]
  folders: FileBookmarkFolder[]
  notes: FileNote[]
  files: ManagedFile[]
}>

const EMPTY_STATE: InboxState = { items: [], bookmarks: [], folders: [], notes: [], files: [] }

function itemIcon(item: CaptureInboxItem) {
  if (item.captureType === "网页摘录") return Highlighter
  if (item.captureType === "网页快照") return FileDown
  if (item.captureType === "图片") return ImageIcon
  if (item.kind === "file") return FileText
  return Bookmark
}

export default function InboxPage() {
  const active = useTabActive()
  const [state, setState] = React.useState<InboxState>(EMPTY_STATE)
  const [loading, setLoading] = React.useState(true)
  const [archiving, setArchiving] = React.useState<string | null>(null)
  const [importOpen, setImportOpen] = React.useState(false)
  const [guideHidden, setGuideHidden] = React.useState(false)
  const onboardingPhase = React.useSyncExternalStore(
    subscribeCaptureOnboarding,
    getCaptureOnboardingPhase,
    getServerCaptureOnboardingPhase,
  )
  const showOnboarding =
    !guideHidden &&
    state.items.length > 0 &&
    (onboardingPhase === "captured" || onboardingPhase === "prompted")

  const reload = React.useCallback(async () => {
    const [bookmarkData, notes, files] = await Promise.all([
      listBookmarkFiles(),
      listNoteFiles(true),
      loadManagedFiles(),
    ])
    setState({
      items: buildCaptureInboxItems(bookmarkData.bookmarks, notes, files),
      bookmarks: bookmarkData.bookmarks,
      folders: bookmarkData.folders,
      notes,
      files,
    })
    setLoading(false)
  }, [])

  React.useEffect(() => {
    if (!active) return
    let alive = true
    void reload().catch((error) => {
      if (!alive) return
      setLoading(false)
      toast.error("读取收件箱失败", { description: String(error) })
    })
    let timer: ReturnType<typeof setTimeout> | undefined
    const watch = watchFileSet(INBOX_ROOTS, WATCH_CONTEXT, () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        void reload().catch((error) =>
          toast.error("刷新收件箱失败", { description: String(error) }),
        )
      }, 200)
    })
    return () => {
      alive = false
      clearTimeout(timer)
      watch?.dispose()
    }
  }, [active, reload])

  function openItem(item: CaptureInboxItem) {
    openTarget({
      type: "file",
      ref: resourceFileRef({ scheme: "node", kind: item.kind, id: item.id }),
      title: item.title,
      rootId: "home",
    })
  }

  async function archiveItem(item: CaptureInboxItem) {
    if (archiving) return
    setArchiving(`${item.kind}:${item.id}`)
    try {
      if (item.kind === "bookmark") {
        const bookmark = state.bookmarks.find((candidate) => candidate.id === item.id)
        if (!bookmark) throw new Error("书签已不存在")
        const folder =
          bookmark.folderId === null
            ? null
            : (state.folders.find((candidate) => candidate.id === bookmark.folderId) ?? null)
        if (bookmark.folderId !== null && !folder) throw new Error("书签收藏夹已不存在")
        await updateBookmarkFile(bookmark, {
          title: bookmark.title,
          url: bookmark.url,
          description: bookmark.description,
          favicon: bookmark.favicon,
          tags: withoutCaptureInboxTag(bookmark.tags),
          folder,
        })
      } else if (item.kind === "note") {
        const note = state.notes.find((candidate) => candidate.id === item.id)
        if (!note) throw new Error("笔记已不存在")
        await updateNoteFileTags(note, withoutCaptureInboxTag(note.tags))
      } else {
        const file = state.files.find((candidate) => candidate.id === item.id)
        if (!file) throw new Error("资源已不存在")
        await updateManagedFileTags(file, withoutCaptureInboxTag(file.tags))
      }
      await reload()
      const onboardingCompleted = completeCaptureOnboarding()
      toast.success(onboardingCompleted ? "第一次整理已完成" : "已移出收件箱", {
        description: onboardingCompleted ? `${item.title} 仍保留在“我的”中` : item.title,
      })
    } catch (error) {
      toast.error("归档失败", { description: String(error) })
      await reload().catch(() => {})
    } finally {
      setArchiving(null)
    }
  }

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        加载收件箱…
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Inbox className="h-5 w-5" />
            收件箱
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            浏览器捕获和外部文件先汇入这里；打开处理，或归档以保留原对象并移出列表。
          </p>
        </div>
        <Button variant="outline" onClick={() => setImportOpen(true)}>
          <Import className="mr-1.5 h-4 w-4" />
          导入
        </Button>
      </div>

      {showOnboarding ? (
        <Panel className="border-primary/30 bg-primary/5">
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <span className="rounded-md bg-primary/10 p-2 text-primary">
                <CheckCircle2 className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold">第一次保存已完成</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  保存时不用先分类。内容会留在原来的书签、笔记或文件中，收件箱只负责提醒你稍后整理。
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0"
                onClick={() => {
                  setGuideHidden(true)
                  completeCaptureOnboarding()
                }}
              >
                不再提示
              </Button>
            </div>
            <ol className="grid gap-2 text-[13px] sm:grid-cols-3">
              <li className="flex items-start gap-2 rounded-md border bg-background/70 p-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span>
                  <strong className="block font-medium">1. 保存</strong>
                  <span className="text-muted-foreground">一键进入收件箱</span>
                </span>
              </li>
              <li className="flex items-start gap-2 rounded-md border bg-background/70 p-3">
                <MousePointerClick className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span>
                  <strong className="block font-medium">2. 检查</strong>
                  <span className="text-muted-foreground">打开条目查看内容</span>
                </span>
              </li>
              <li className="flex items-start gap-2 rounded-md border bg-background/70 p-3">
                <PackageCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span>
                  <strong className="block font-medium">3. 归档</strong>
                  <span className="text-muted-foreground">处理完成后移出列表</span>
                </span>
              </li>
            </ol>
          </div>
        </Panel>
      ) : null}

      {state.items.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="收件箱已清空"
          description="新保存的书签、网页快照、选中文本摘录和导入文件会出现在这里。"
        />
      ) : (
        <div className="flex flex-col gap-2">
          <p className="px-1 text-xs font-medium text-muted-foreground">
            待整理 {state.items.length} 项
          </p>
          {state.items.map((item) => {
            const Icon = itemIcon(item)
            const key = `${item.kind}:${item.id}`
            return (
              <div
                key={key}
                className="flex items-start gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-accent/25"
              >
                <button
                  type="button"
                  onClick={() => openItem(item)}
                  className="flex min-w-0 flex-1 items-start gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="mt-0.5 rounded-md bg-muted p-2 text-muted-foreground">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{item.title}</span>
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {item.captureType}
                      </span>
                    </span>
                    <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-muted-foreground">
                      {item.summary}
                    </span>
                    <span className="mt-1 block text-[11px] text-muted-foreground/70">
                      {formatTime(item.timestamp)}
                    </span>
                  </span>
                </button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={archiving !== null}
                  onClick={() => void archiveItem(item)}
                  title="保留原对象并移出收件箱"
                  className="shrink-0"
                >
                  {archiving === key ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Archive className="mr-1 h-3.5 w-3.5" />
                  )}
                  归档
                </Button>
              </div>
            )
          })}
        </div>
      )}
      <CaptureImportDialog open={importOpen} onOpenChange={setImportOpen} onImported={reload} />
    </div>
  )
}
