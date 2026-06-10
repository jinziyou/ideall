"use client"

import * as React from "react"
import { toast } from "sonner"
import {
  ExternalLink,
  FolderPlus,
  Globe,
  Inbox,
  Layers,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
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
import { ConfirmDialog, TextPromptDialog } from "@/components/prompt-dialog"
import { cn } from "@/lib/utils"
import { safeHref, openExternal } from "@/lib/safe-url"
import { Bookmark, BookmarkFolder } from "../model"
import {
  addFolder,
  deleteBookmark,
  deleteFolder,
  listBookmarks,
  listFolders,
  renameFolder,
  updateBookmark,
} from "../lib/bookmarks-store"
import { formatTime } from "@/lib/hub-format"
import BookmarkDialog from "./bookmark-dialog"
import ImportDialog from "./import-dialog"

// 侧栏选中项: 全部 / 未分组 / 具体收藏夹 id
type FolderFilter = "all" | "none" | string

export default function BookmarkManager() {
  const [folders, setFolders] = React.useState<BookmarkFolder[]>([])
  const [bookmarks, setBookmarks] = React.useState<Bookmark[]>([])
  const [active, setActive] = React.useState<FolderFilter>("all")
  const [query, setQuery] = React.useState("")
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<Bookmark | null>(null)
  const [importOpen, setImportOpen] = React.useState(false)
  // 收藏夹对话框状态 (替代 window.prompt/confirm): 重命名/删除以目标夹对象控制 open
  const [newFolderOpen, setNewFolderOpen] = React.useState(false)
  const [renameTarget, setRenameTarget] = React.useState<BookmarkFolder | null>(null)
  const [deleteTarget, setDeleteTarget] = React.useState<BookmarkFolder | null>(null)

  const refresh = React.useCallback(async () => {
    try {
      const [f, b] = await Promise.all([listFolders(), listBookmarks()])
      setFolders(f)
      setBookmarks(b)
    } catch (e) {
      toast.error("读取本地链接失败", { description: String(e) })
    }
  }, [])

  // 首次挂载加载: setState 仅发生在 await 之后, 满足 react-hooks 规则
  React.useEffect(() => {
    let active = true
    async function load() {
      try {
        const [f, b] = await Promise.all([listFolders(), listBookmarks()])
        if (active) {
          setFolders(f)
          setBookmarks(b)
        }
      } catch (e) {
        toast.error("读取本地链接失败", { description: String(e) })
      }
    }
    load()
    return () => {
      active = false
    }
  }, [])

  // 计数: 每个夹下的书签数
  const counts = React.useMemo(() => {
    const map = new Map<FolderFilter, number>()
    map.set("all", bookmarks.length)
    map.set("none", bookmarks.filter((b) => b.folderId === null).length)
    for (const f of folders) {
      map.set(f.id, bookmarks.filter((b) => b.folderId === f.id).length)
    }
    return map
  }, [bookmarks, folders])

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return bookmarks.filter((b) => {
      if (active === "none" && b.folderId !== null) return false
      if (active !== "all" && active !== "none" && b.folderId !== active) return false
      if (!q) return true
      return (
        b.title.toLowerCase().includes(q) ||
        b.url.toLowerCase().includes(q) ||
        b.description.toLowerCase().includes(q) ||
        b.tags.some((t) => t.toLowerCase().includes(q))
      )
    })
  }, [bookmarks, active, query])

  function openAdd() {
    setEditing(null)
    setDialogOpen(true)
  }

  function openEdit(b: Bookmark) {
    setEditing(b)
    setDialogOpen(true)
  }

  async function handleNewFolder(name: string) {
    try {
      const folder = await addFolder(name)
      await refresh()
      setActive(folder.id)
    } catch (e) {
      toast.error("创建失败", { description: String(e) })
    }
  }

  async function handleRenameFolder(folder: BookmarkFolder, name: string) {
    if (name === folder.name) return
    try {
      await renameFolder(folder.id, name)
      await refresh()
    } catch (e) {
      toast.error("重命名失败", { description: String(e) })
    }
  }

  async function handleDeleteFolder(folder: BookmarkFolder) {
    try {
      await deleteFolder(folder.id)
      if (active === folder.id) setActive("all")
      await refresh()
    } catch (e) {
      toast.error("删除失败", { description: String(e) })
    }
  }

  async function handleDeleteBookmark(b: Bookmark) {
    try {
      await deleteBookmark(b.id)
      setBookmarks((prev) => prev.filter((x) => x.id !== b.id))
    } catch (e) {
      toast.error("删除失败", { description: String(e) })
    }
  }

  async function handleMove(b: Bookmark, folderId: string | null) {
    if (b.folderId === folderId) return
    try {
      await updateBookmark(b.id, { folderId })
      setBookmarks((prev) => prev.map((x) => (x.id === b.id ? { ...x, folderId } : x)))
    } catch (e) {
      toast.error("移动失败", { description: String(e) })
    }
  }

  return (
    <div className="flex flex-col gap-4 md:flex-row">
      {/* 侧栏: 收藏夹 */}
      <aside className="md:w-52 md:shrink-0">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">收藏夹</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setNewFolderOpen(true)}
            title="新建收藏夹"
          >
            <FolderPlus className="h-4 w-4" />
          </Button>
        </div>
        <nav className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
          <FolderItem
            icon={<Layers className="h-4 w-4" />}
            label="全部"
            count={counts.get("all") ?? 0}
            active={active === "all"}
            onClick={() => setActive("all")}
          />
          <FolderItem
            icon={<Inbox className="h-4 w-4" />}
            label="未分组"
            count={counts.get("none") ?? 0}
            active={active === "none"}
            onClick={() => setActive("none")}
          />
          {folders.map((f) => (
            <FolderItem
              key={f.id}
              icon={<Globe className="h-4 w-4" />}
              label={f.name}
              count={counts.get(f.id) ?? 0}
              active={active === f.id}
              onClick={() => setActive(f.id)}
              onRename={() => setRenameTarget(f)}
              onDelete={() => setDeleteTarget(f)}
            />
          ))}
        </nav>
      </aside>

      {/* 主区 */}
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {/* 工具栏 */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜索标题 / 网址 / 标签"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8"
            />
          </div>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="mr-2 h-4 w-4" />
              导入书签
            </Button>
            <Button onClick={openAdd}>
              <Plus className="mr-2 h-4 w-4" />
              新增链接
            </Button>
          </div>
        </div>

        {/* 链接列表 */}
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed py-16 text-center text-sm text-muted-foreground">
            {bookmarks.length === 0
              ? "还没有收藏链接，新增一条或导入浏览器书签试试。"
              : "没有匹配的链接。"}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((b) => (
              <BookmarkCard
                key={b.id}
                bookmark={b}
                folders={folders}
                onEdit={() => openEdit(b)}
                onDelete={() => handleDeleteBookmark(b)}
                onMove={(folderId) => handleMove(b, folderId)}
              />
            ))}
          </div>
        )}
      </div>

      <BookmarkDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        folders={folders}
        editing={editing}
        defaultFolderId={active !== "all" && active !== "none" ? active : null}
        onSaved={refresh}
      />
      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        folders={folders}
        onImported={refresh}
      />
      <TextPromptDialog
        open={newFolderOpen}
        onOpenChange={setNewFolderOpen}
        title="新建收藏夹"
        label="名称"
        onSubmit={(name) => handleNewFolder(name)}
      />
      <TextPromptDialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null)
        }}
        title="重命名收藏夹"
        label="名称"
        defaultValue={renameTarget?.name ?? ""}
        onSubmit={(name) => {
          if (renameTarget) handleRenameFolder(renameTarget, name)
        }}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        destructive
        title={`删除收藏夹「${deleteTarget?.name ?? ""}」?`}
        description="夹内链接将移到「未分组」, 不会被删除。"
        confirmLabel="删除"
        onConfirm={() => {
          if (deleteTarget) handleDeleteFolder(deleteTarget)
        }}
      />
    </div>
  )
}

function FolderItem({
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
        "group flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors md:shrink",
        active ? "bg-accent font-medium" : "hover:bg-accent/50",
      )}
    >
      <button type="button" onClick={onClick} className="flex min-w-0 flex-1 items-center gap-2">
        {icon}
        <span className="truncate">{label}</span>
      </button>
      <span className="text-xs text-muted-foreground">{count}</span>
      {(onRename || onDelete) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
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

function BookmarkCard({
  bookmark: b,
  folders,
  onEdit,
  onDelete,
  onMove,
}: {
  bookmark: Bookmark
  folders: BookmarkFolder[]
  onEdit: () => void
  onDelete: () => void
  onMove: (folderId: string | null) => void
}) {
  const [iconError, setIconError] = React.useState(false)
  let host = b.url
  try {
    host = new URL(b.url).hostname
  } catch {
    /* 非法 URL 时直接显示原文 */
  }

  return (
    <div className="group flex flex-col gap-2 rounded-lg border bg-card p-3 text-card-foreground transition-shadow hover:shadow-md">
      <div className="flex items-start gap-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
          {b.favicon && !iconError ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={b.favicon} alt="" className="h-5 w-5" onError={() => setIconError(true)} />
          ) : (
            <Globe className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
        <a
          href={safeHref(b.url)}
          target="_blank"
          rel="noreferrer noopener"
          className="min-w-0 flex-1"
        >
          <div className="truncate text-sm font-medium hover:underline" title={b.title}>
            {b.title}
          </div>
          <div className="truncate text-xs text-muted-foreground" title={b.url}>
            {host}
          </div>
        </a>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">操作</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => openExternal(b.url)}>
              <ExternalLink className="mr-2 h-4 w-4" />
              打开
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="mr-2 h-4 w-4" />
              编辑
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Layers className="mr-2 h-4 w-4" />
                移动到
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem disabled={b.folderId === null} onClick={() => onMove(null)}>
                  未分组
                </DropdownMenuItem>
                {folders.map((f) => (
                  <DropdownMenuItem
                    key={f.id}
                    disabled={b.folderId === f.id}
                    onClick={() => onMove(f.id)}
                  >
                    {f.name}
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

      {b.description && (
        <p className="line-clamp-2 text-xs text-muted-foreground">{b.description}</p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-1">
        {b.tags.map((t) => (
          <Badge key={t} variant="secondary" className="font-normal">
            {t}
          </Badge>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">{formatTime(b.createdAt)}</span>
      </div>
    </div>
  )
}
