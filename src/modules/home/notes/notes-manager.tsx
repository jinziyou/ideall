"use client"

// 笔记面板 (home-notes 标签): 搜索 + 最近笔记列表 + 新建。
// 完整页树与编辑在二级侧栏文件树 + 内容标签 (note-viewer), 此处不再重复页树。
import * as React from "react"
import { toast } from "sonner"
import { FilePlus2, FileText, Loader2, Plus, Search } from "lucide-react"
import { Button } from "@/ui/button"
import { Input } from "@/ui/input"
import { Badge } from "@/ui/badge"
import { cn } from "@/lib/utils"
import { formatTime } from "@/lib/node-format"
import type { NoteMeta } from "@protocol/files"
import { addNote, listNotes } from "@/files/stores/notes-store"
import { openNodeTab } from "@/workspace/store"
import { refreshSidebarTree, subscribeSidebarTreeRefresh } from "@/workspace/tree/sidebar-tree-bus"
import { EmptyState } from "@/ui/empty-state"

export default function NotesManager() {
  const [notes, setNotes] = React.useState<NoteMeta[]>([])
  const [loading, setLoading] = React.useState(true)
  const [query, setQuery] = React.useState("")

  const reload = React.useCallback(async () => {
    try {
      setNotes(await listNotes())
    } catch (e) {
      toast.error("读取笔记失败", { description: String(e) })
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void reload()
  }, [reload])

  React.useEffect(() => subscribeSidebarTreeRefresh(() => void reload()), [reload])

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    const sorted = [...notes].sort((a, b) => b.updatedAt - a.updatedAt)
    if (!q) return sorted.slice(0, 20)
    return sorted.filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        n.search.toLowerCase().includes(q) ||
        n.tags.some((t) => t.toLowerCase().includes(q)),
    )
  }, [notes, query])

  const searching = query.trim().length > 0

  async function handleNewRoot() {
    try {
      const note = await addNote({ parentId: null })
      await reload()
      refreshSidebarTree()
      openNodeTab({ kind: "note", id: note.id }, note.title || "无标题")
    } catch (e) {
      toast.error("新建失败", { description: String(e) })
    }
  }

  function openNote(n: NoteMeta) {
    openNodeTab({ kind: "note", id: n.id }, n.title || "无标题")
  }

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        加载笔记…
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">笔记</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          在左侧文件树浏览全部笔记；此处可搜索或查看最近编辑。
        </p>
      </div>

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
        <Button onClick={handleNewRoot} title="新建页面">
          <Plus className="mr-1 h-4 w-4" />
          新建
        </Button>
      </div>

      {notes.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="还没有笔记"
          action={
            <Button variant="outline" onClick={handleNewRoot}>
              <FilePlus2 className="mr-2 h-4 w-4" />
              新建第一篇
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="没有匹配的笔记。" />
      ) : (
        <div className="flex flex-col gap-1">
          {!searching && (
            <p className="px-1 text-xs font-medium text-muted-foreground">最近编辑</p>
          )}
          {filtered.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => openNote(n)}
              className={cn(
                "flex flex-col gap-0.5 rounded-lg border border-transparent px-3 py-2.5 text-left text-sm transition-colors hover:border-border hover:bg-accent/40",
              )}
            >
              <span className="flex items-center gap-2 truncate font-medium">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                {n.title || <span className="text-muted-foreground">无标题</span>}
                {n.tags.slice(0, 2).map((t) => (
                  <Badge key={t} variant="secondary" className="text-[10px] font-normal">
                    {t}
                  </Badge>
                ))}
              </span>
              {n.excerpt && (
                <span className="line-clamp-1 pl-6 text-xs text-muted-foreground">{n.excerpt}</span>
              )}
              <span className="pl-6 text-[11px] text-muted-foreground/70">
                {formatTime(n.updatedAt)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
