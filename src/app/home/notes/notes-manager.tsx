"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { toast } from "sonner"
import {
  ChevronLeft,
  FilePlus2,
  FileText,
  FolderPlus,
  Inbox,
  Layers,
  Loader2,
  MoreHorizontal,
  Notebook as NotebookIcon,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ConfirmDialog, TextPromptDialog } from "@/components/shared/prompt-dialog"
import { cn } from "@/components/lib/utils"
import { formatTime } from "@/components/lib/hub-format"
import { useIncrementalList } from "@/components/lib/use-incremental-list"
import { Note, NoteMeta, Notebook } from "../model"
import {
  addNote,
  addNotebook,
  deleteNote,
  deleteNotebook,
  getNote,
  listNotebooks,
  listNotes,
  renameNotebook,
  restoreNote,
  updateNote,
} from "../lib/notes-store"
import { undoableDeleteToast } from "@/components/lib/undo-toast"
import type { NoteEditorSaved } from "./note-editor"

// 编辑器为纯客户端组件 (Plate), 懒加载并禁用 SSR, 避开预渲染与静态导出。
const NoteEditor = dynamic(() => import("./note-editor"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      编辑器加载中…
    </div>
  ),
})

// 侧栏选中项: 全部 / 未分组 / 具体笔记本 id
type NotebookFilter = "all" | "none" | string

export default function NotesManager() {
  const [notebooks, setNotebooks] = React.useState<Notebook[]>([])
  const [notes, setNotes] = React.useState<NoteMeta[]>([])
  const [active, setActive] = React.useState<NotebookFilter>("all")
  const [query, setQuery] = React.useState("")
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [loadedNote, setLoadedNote] = React.useState<Note | null>(null)
  // 笔记本对话框状态 (替代 window.prompt/confirm)
  const [newNotebookOpen, setNewNotebookOpen] = React.useState(false)
  const [renameTarget, setRenameTarget] = React.useState<Notebook | null>(null)
  const [deleteTarget, setDeleteTarget] = React.useState<Notebook | null>(null)

  // 首次挂载加载
  React.useEffect(() => {
    let alive = true
    async function load() {
      try {
        const [nb, n] = await Promise.all([listNotebooks(), listNotes()])
        if (alive) {
          setNotebooks(nb)
          setNotes(n)
        }
      } catch (e) {
        toast.error("读取笔记失败", { description: String(e) })
      }
    }
    load()
    return () => {
      alive = false
    }
  }, [])

  // 选中笔记 → 拉取完整正文供编辑器初始化 (setState 仅发生在 await 之后, 不在 effect 体内同步触发)
  React.useEffect(() => {
    if (!selectedId) return
    let alive = true
    getNote(selectedId)
      .then((note) => {
        if (!alive) return
        if (!note) {
          // 笔记已不存在 (例如在另一标签页被删除, 或 id 失效): 退出选中、从列表剔除,
          // 避免编辑区永久卡在「打开中…」转圈而无恢复路径。
          toast.error("笔记不存在或已被删除")
          setNotes((prev) => prev.filter((n) => n.id !== selectedId))
          setSelectedId(null)
          return
        }
        setLoadedNote(note)
      })
      .catch((e) => {
        if (alive) toast.error("打开笔记失败", { description: String(e) })
      })
    return () => {
      alive = false
    }
  }, [selectedId])

  async function refreshNotebooks() {
    try {
      setNotebooks(await listNotebooks())
    } catch (e) {
      toast.error("读取笔记本失败", { description: String(e) })
    }
  }

  const counts = React.useMemo(() => {
    const map = new Map<NotebookFilter, number>()
    map.set("all", notes.length)
    map.set("none", notes.filter((n) => n.notebookId === null).length)
    for (const nb of notebooks) {
      map.set(nb.id, notes.filter((n) => n.notebookId === nb.id).length)
    }
    return map
  }, [notes, notebooks])

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return notes.filter((n) => {
      if (active === "none" && n.notebookId !== null) return false
      if (active !== "all" && active !== "none" && n.notebookId !== active) return false
      if (!q) return true
      return (
        n.title.toLowerCase().includes(q) ||
        n.search.toLowerCase().includes(q) ||
        n.tags.some((t) => t.toLowerCase().includes(q))
      )
    })
  }, [notes, active, query])

  const { visible, hasMore, sentinelRef, shown, total } = useIncrementalList(filtered, {
    resetKey: `${active}|${query}`,
  })

  async function handleNewNote() {
    const notebookId = active !== "all" && active !== "none" ? active : null
    try {
      const note = await addNote({ notebookId })
      const meta: NoteMeta = {
        id: note.id,
        title: note.title,
        notebookId: note.notebookId,
        tags: note.tags,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
        excerpt: "",
        search: "",
      }
      setNotes((prev) => [meta, ...prev])
      setLoadedNote(note)
      setSelectedId(note.id)
    } catch (e) {
      toast.error("新建失败", { description: String(e) })
    }
  }

  // 编辑器每次自动保存后就地刷新列表项 (标题/摘要/标签/时间), 并按最近编辑重排
  const handleSaved = React.useCallback((meta: NoteEditorSaved) => {
    setNotes((prev) =>
      prev
        .map((n) =>
          n.id === meta.id
            ? {
                ...n,
                title: meta.title,
                excerpt: meta.excerpt,
                search: meta.search,
                tags: meta.tags,
                updatedAt: meta.updatedAt,
              }
            : n,
        )
        .sort((a, b) => b.updatedAt - a.updatedAt),
    )
  }, [])

  async function handleMoveNote(note: NoteMeta, notebookId: string | null) {
    if (note.notebookId === notebookId) return
    try {
      // updateNote 会刷新 updatedAt; 用返回值同步本地并按最近编辑重排, 避免列表与 IDB 时间/顺序脱节
      const saved = await updateNote(note.id, { notebookId })
      const updatedAt = saved?.updatedAt ?? note.updatedAt
      setNotes((prev) =>
        prev
          .map((n) => (n.id === note.id ? { ...n, notebookId, updatedAt } : n))
          .sort((a, b) => b.updatedAt - a.updatedAt),
      )
    } catch (e) {
      toast.error("移动失败", { description: String(e) })
    }
  }

  async function handleDeleteNote(note: NoteMeta) {
    try {
      // 列表只有元数据, 先取完整正文供撤销原样写回
      const full = await getNote(note.id)
      await deleteNote(note.id)
      setNotes((prev) => prev.filter((n) => n.id !== note.id))
      if (selectedId === note.id) {
        setSelectedId(null)
        setLoadedNote(null)
      }
      if (full) {
        undoableDeleteToast(note.title || "无标题", async () => {
          await restoreNote(full)
          setNotes((prev) =>
            [note, ...prev.filter((n) => n.id !== note.id)].sort(
              (a, b) => b.updatedAt - a.updatedAt,
            ),
          )
        })
      }
    } catch (e) {
      toast.error("删除失败", { description: String(e) })
    }
  }

  async function handleNewNotebook(name: string) {
    try {
      const nb = await addNotebook(name)
      await refreshNotebooks()
      setActive(nb.id)
    } catch (e) {
      toast.error("创建失败", { description: String(e) })
    }
  }

  async function handleRenameNotebook(nb: Notebook, name: string) {
    if (name === nb.name) return
    try {
      await renameNotebook(nb.id, name)
      await refreshNotebooks()
    } catch (e) {
      toast.error("重命名失败", { description: String(e) })
    }
  }

  async function handleDeleteNotebook(nb: Notebook) {
    try {
      await deleteNotebook(nb.id)
      if (active === nb.id) setActive("all")
      await Promise.all([refreshNotebooks(), listNotes().then(setNotes)])
    } catch (e) {
      toast.error("删除失败", { description: String(e) })
    }
  }

  return (
    <div className="flex flex-col gap-4 md:h-[calc(100dvh-6rem)] md:min-h-[34rem] md:flex-row">
      {/* 左: 笔记本筛选 + 笔记列表 (移动端选中笔记时让位给编辑器) */}
      <div
        className={cn(
          "flex w-full flex-col gap-3 md:w-80 md:shrink-0",
          selectedId && "hidden md:flex",
        )}
      >
        {/* 笔记本筛选行: 筛选 chip 横向滚动, 「新建笔记本」固定在末端常驻可见 */}
        <div className="flex items-center gap-1">
          <div className="flex flex-1 items-center gap-1 overflow-x-auto pb-0.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar]:h-1.5">
            <NotebookChip
              icon={<Layers className="h-3.5 w-3.5" />}
              label="全部"
              count={counts.get("all") ?? 0}
              active={active === "all"}
              onClick={() => setActive("all")}
            />
            <NotebookChip
              icon={<Inbox className="h-3.5 w-3.5" />}
              label="未分组"
              count={counts.get("none") ?? 0}
              active={active === "none"}
              onClick={() => setActive("none")}
            />
            {notebooks.map((nb) => (
              <NotebookChip
                key={nb.id}
                icon={<NotebookIcon className="h-3.5 w-3.5" />}
                label={nb.name}
                count={counts.get(nb.id) ?? 0}
                active={active === nb.id}
                onClick={() => setActive(nb.id)}
                onRename={() => setRenameTarget(nb)}
                onDelete={() => setDeleteTarget(nb)}
              />
            ))}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={() => setNewNotebookOpen(true)}
            title="新建笔记本"
          >
            <FolderPlus className="h-4 w-4" />
            <span className="sr-only">新建笔记本</span>
          </Button>
        </div>

        {/* 搜索 + 新建笔记 */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜索标题 / 正文 / 标签"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8"
            />
          </div>
          <Button onClick={handleNewNote} title="新建笔记">
            <Plus className="mr-1 h-4 w-4" />
            新建
          </Button>
        </div>

        {/* 笔记列表 */}
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto md:pr-1">
          {filtered.length === 0 ? (
            <div className="rounded-lg border border-dashed py-16 text-center text-sm text-muted-foreground">
              {notes.length === 0 ? "还没有笔记。点「新建」写第一篇。" : "没有匹配的笔记。"}
            </div>
          ) : (
            visible.map((n) => (
              <NoteCard
                key={n.id}
                note={n}
                notebooks={notebooks}
                active={selectedId === n.id}
                onOpen={() => setSelectedId(n.id)}
                onMove={(notebookId) => handleMoveNote(n, notebookId)}
                onDelete={() => handleDeleteNote(n)}
              />
            ))
          )}
          {hasMore && (
            <div
              ref={sentinelRef}
              className="flex items-center justify-center py-4 text-xs text-muted-foreground"
            >
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              加载更多…（已显示 {shown} / {total}）
            </div>
          )}
        </div>
      </div>

      {/* 右: 编辑器 (移动端未选中时让位给列表) */}
      <div
        className={cn("min-w-0 flex-1 rounded-xl border bg-card", !selectedId && "hidden md:block")}
      >
        {!selectedId ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
            <FileText className="h-10 w-10 opacity-40" />
            <p className="text-sm">选一篇笔记开始编辑，或</p>
            <Button variant="outline" onClick={handleNewNote}>
              <FilePlus2 className="mr-2 h-4 w-4" />
              新建笔记
            </Button>
          </div>
        ) : loadedNote && loadedNote.id === selectedId ? (
          <div className="flex h-full flex-col overflow-hidden">
            {/* 移动端返回列表 */}
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="flex items-center gap-1 px-3 py-2 text-sm text-muted-foreground md:hidden"
            >
              <ChevronLeft className="h-4 w-4" />
              返回列表
            </button>
            <NoteEditor
              key={loadedNote.id}
              noteId={loadedNote.id}
              initialTitle={loadedNote.title}
              initialContent={loadedNote.content}
              initialTags={loadedNote.tags}
              onSaved={handleSaved}
            />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            打开中…
          </div>
        )}
      </div>

      {/* 笔记本对话框 */}
      <TextPromptDialog
        open={newNotebookOpen}
        onOpenChange={setNewNotebookOpen}
        title="新建笔记本"
        label="名称"
        onSubmit={(name) => handleNewNotebook(name)}
      />
      <TextPromptDialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null)
        }}
        title="重命名笔记本"
        label="名称"
        defaultValue={renameTarget?.name ?? ""}
        onSubmit={(name) => {
          if (renameTarget) handleRenameNotebook(renameTarget, name)
        }}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        destructive
        title={`删除笔记本「${deleteTarget?.name ?? ""}」?`}
        description="本内笔记将移到「未分组」，不会删除。"
        confirmLabel="删除"
        onConfirm={() => {
          if (deleteTarget) handleDeleteNotebook(deleteTarget)
        }}
      />
    </div>
  )
}

function NotebookChip({
  icon,
  label,
  count,
  active,
  onClick,
  onRename,
  onDelete,
}: {
  icon: React.ReactNode
  label: string
  count: number
  active: boolean
  onClick: () => void
  onRename?: () => void
  onDelete?: () => void
}) {
  return (
    <div
      className={cn(
        "group flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
        active ? "border-primary/30 bg-primary/10 font-medium text-primary" : "hover:bg-accent/60",
      )}
    >
      <button type="button" onClick={onClick} className="flex items-center gap-1.5">
        {icon}
        <span className="max-w-[8rem] truncate">{label}</span>
        <span className="text-muted-foreground">{count}</span>
      </button>
      {(onRename || onDelete) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="-mr-1 grid h-4 w-4 place-items-center rounded opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
            >
              <MoreHorizontal className="h-3 w-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {onRename && (
              <DropdownMenuItem onClick={onRename}>
                <Pencil className="mr-2 h-4 w-4" />
                重命名
              </DropdownMenuItem>
            )}
            {onDelete && (
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={onDelete}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                删除
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

function NoteCard({
  note,
  notebooks,
  active,
  onOpen,
  onMove,
  onDelete,
}: {
  note: NoteMeta
  notebooks: Notebook[]
  active: boolean
  onOpen: () => void
  onMove: (notebookId: string | null) => void
  onDelete: () => void
}) {
  return (
    <div
      onClick={onOpen}
      className={cn(
        "group flex cursor-pointer flex-col gap-1.5 rounded-lg border bg-card px-3 py-2.5 text-card-foreground transition-colors hover:bg-accent/40",
        active && "border-primary/50 bg-primary/10 ring-1 ring-primary/20",
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium" title={note.title || "无标题"}>
            {note.title || <span className="text-muted-foreground">无标题</span>}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              className="grid h-6 w-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent"
            >
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">操作</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Layers className="mr-2 h-4 w-4" />
                移动到
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem disabled={note.notebookId === null} onClick={() => onMove(null)}>
                  未分组
                </DropdownMenuItem>
                {notebooks.map((nb) => (
                  <DropdownMenuItem
                    key={nb.id}
                    disabled={note.notebookId === nb.id}
                    onClick={() => onMove(nb.id)}
                  >
                    {nb.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={onDelete}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {note.excerpt && <p className="line-clamp-2 text-xs text-muted-foreground">{note.excerpt}</p>}

      <div className="mt-auto flex flex-wrap items-center gap-1">
        {note.tags.map((t) => (
          <Badge key={t} variant="secondary" className="font-normal">
            {t}
          </Badge>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">{formatTime(note.updatedAt)}</span>
      </div>
    </div>
  )
}
