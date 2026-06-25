"use client"

// 笔记 —— Notion 式「目录即页面」递归页树 + 块编辑器。
// 左: 页树侧栏 (展开/折叠、添加子页、拖拽换父/重排); 右: 面包屑 + 编辑器。搜索时切为扁平结果列表。
import * as React from "react"
import dynamic from "next/dynamic"
import { toast } from "sonner"
import { ChevronLeft, ChevronRight, FilePlus2, FileText, Loader2, Plus, Search } from "lucide-react"
import { Button } from "@/ui/button"
import { Input } from "@/ui/input"
import { Badge } from "@/ui/badge"
import { ConfirmDialog } from "@/shared/prompt-dialog"
import { cn } from "@/lib/utils"
import { formatTime } from "@/lib/node-format"
import { undoableDeleteToast } from "@/lib/undo-toast"
import { Note, NoteMeta } from "../model"
import {
  addNote,
  deleteNote,
  getAncestors,
  getNote,
  listNotes,
  moveNote,
  restoreSubtree,
} from "@/files/stores/notes-store"
import { PageTree, type InsertPos } from "./notes-tree"
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

const EXPANDED_KEY = "ideall:notes:expanded"

/** 统计某节点的后代数 (不含自身), 供级联删除确认文案。 */
function countDescendants(notes: NoteMeta[], id: string): number {
  const childrenOf = new Map<string, string[]>()
  const liveIds = new Set(notes.map((n) => n.id))
  for (const n of notes) {
    const ep = n.parentId != null && liveIds.has(n.parentId) ? n.parentId : null
    if (ep == null) continue
    const arr = childrenOf.get(ep) ?? []
    arr.push(n.id)
    childrenOf.set(ep, arr)
  }
  let count = 0
  const queue = [...(childrenOf.get(id) ?? [])]
  const seen = new Set<string>()
  while (queue.length) {
    const cur = queue.shift() as string
    if (seen.has(cur)) continue
    seen.add(cur)
    count++
    queue.push(...(childrenOf.get(cur) ?? []))
  }
  return count
}

export default function NotesManager() {
  const [notes, setNotes] = React.useState<NoteMeta[]>([])
  const [query, setQuery] = React.useState("")
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [loadedNote, setLoadedNote] = React.useState<Note | null>(null)
  const [ancestors, setAncestors] = React.useState<NoteMeta[]>([])
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set())
  const [deleteTarget, setDeleteTarget] = React.useState<{ note: NoteMeta; count: number } | null>(
    null,
  )

  const reload = React.useCallback(async () => {
    try {
      setNotes(await listNotes())
    } catch (e) {
      toast.error("读取笔记失败", { description: String(e) })
    }
  }, [])

  // 首次加载 + 恢复展开状态 (setState 均在 await 之后, 不在 effect 同步阶段触发)
  React.useEffect(() => {
    let alive = true
    ;(async () => {
      let saved: Set<string> | null = null
      try {
        const raw = localStorage.getItem(EXPANDED_KEY)
        if (raw) saved = new Set(JSON.parse(raw) as string[])
      } catch {
        /* localStorage 不可用时忽略 */
      }
      try {
        const n = await listNotes()
        if (!alive) return
        setNotes(n)
        // 恢复展开状态时与现存节点取交集, 丢弃已删/不存在的陈旧 id (自愈, 避免 localStorage 无限增长)
        if (saved) {
          const liveIds = new Set(n.map((x) => x.id))
          setExpanded(new Set([...saved].filter((id) => liveIds.has(id))))
        }
      } catch (e) {
        if (alive) toast.error("读取笔记失败", { description: String(e) })
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  // 持久化展开状态 (per-device, 绝不进 Note / 不同步)
  React.useEffect(() => {
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expanded]))
    } catch {
      /* 忽略 */
    }
  }, [expanded])

  // 选中 → 拉完整正文 + 祖先链 (面包屑), 并自动展开祖先使其在树中可见。
  // selectedId 为 null 时直接返回: 右侧渲染由 selectedId 守卫, loadedNote 残留不会被渲染 (免在 effect 同步 setState)。
  React.useEffect(() => {
    if (!selectedId) return
    let alive = true
    Promise.all([getNote(selectedId), getAncestors(selectedId)])
      .then(([note, chain]) => {
        if (!alive) return
        if (!note) {
          toast.error("笔记不存在或已被删除")
          setSelectedId(null)
          reload()
          return
        }
        setLoadedNote(note)
        setAncestors(chain)
        if (chain.length) {
          setExpanded((prev) => {
            const next = new Set(prev)
            for (const a of chain) next.add(a.id)
            return next
          })
        }
      })
      .catch((e) => {
        if (alive) toast.error("打开笔记失败", { description: String(e) })
      })
    return () => {
      alive = false
    }
  }, [selectedId, reload])

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return notes
      .filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          n.search.toLowerCase().includes(q) ||
          n.tags.some((t) => t.toLowerCase().includes(q)),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }, [notes, query])

  const onToggle = React.useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  async function selectAndLoad(note: Note) {
    setLoadedNote(note)
    setSelectedId(note.id)
  }

  async function handleNewRoot() {
    try {
      const note = await addNote({ parentId: null })
      await reload()
      await selectAndLoad(note)
    } catch (e) {
      toast.error("新建失败", { description: String(e) })
    }
  }

  async function handleAddChild(parentId: string) {
    try {
      const note = await addNote({ parentId })
      await reload()
      setExpanded((prev) => new Set(prev).add(parentId))
      await selectAndLoad(note)
    } catch (e) {
      toast.error("新建子页失败", { description: String(e) })
    }
  }

  async function handleMove(dragId: string, newParentId: string | null, pos?: InsertPos) {
    try {
      await moveNote(dragId, newParentId, pos)
      // 移到某父下时自动展开该父, 让被移动的页可见
      if (newParentId) setExpanded((prev) => new Set(prev).add(newParentId))
      await reload()
    } catch (e) {
      toast.error("移动失败", { description: String(e) })
    }
  }

  // 编辑器每次自动保存后就地刷新该节点 (标题/摘要/标签/时间), 免整树重取。
  // 同步 loadedNote.title 让面包屑「当前页」段随编辑器标题实时更新 (标题即重命名, Notion 式)。
  const handleSaved = React.useCallback((meta: NoteEditorSaved) => {
    setNotes((prev) =>
      prev.map((n) =>
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
      ),
    )
    setLoadedNote((prev) => (prev && prev.id === meta.id ? { ...prev, title: meta.title } : prev))
  }, [])

  function askDelete(note: NoteMeta) {
    setDeleteTarget({ note, count: countDescendants(notes, note.id) })
  }

  async function handleDelete(note: NoteMeta) {
    try {
      const captured = await deleteNote(note.id)
      const deletedIds = new Set(captured.map((n) => n.id))
      await reload()
      if (selectedId && deletedIds.has(selectedId)) {
        setSelectedId(null)
        setLoadedNote(null)
      }
      if (captured.length) {
        undoableDeleteToast(note.title || "无标题", async () => {
          await restoreSubtree(captured)
          await reload()
        })
      }
    } catch (e) {
      toast.error("删除失败", { description: String(e) })
    }
  }

  const searching = query.trim().length > 0

  return (
    <div className="flex flex-col gap-4 md:h-full md:min-h-[34rem] md:flex-row">
      {/* 左: 搜索 + 新建 + 页树 (移动端选中页时让位给编辑器) */}
      <div
        className={cn(
          "flex w-full flex-col gap-3 md:w-80 md:shrink-0",
          selectedId && "hidden md:flex",
        )}
      >
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

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:pr-1">
          {searching ? (
            filtered.length === 0 ? (
              <div className="rounded-lg border border-dashed py-16 text-center text-sm text-muted-foreground">
                没有匹配的页面。
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {filtered.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => setSelectedId(n.id)}
                    className={cn(
                      "flex flex-col gap-0.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent/60",
                      selectedId === n.id && "bg-primary/10 text-primary",
                    )}
                  >
                    <span className="flex items-center gap-1.5 truncate font-medium">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      {n.title || <span className="text-muted-foreground">无标题</span>}
                    </span>
                    {n.excerpt && (
                      <span className="line-clamp-1 pl-5 text-xs text-muted-foreground">
                        {n.excerpt}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )
          ) : (
            <PageTree
              notes={notes}
              selectedId={selectedId}
              expanded={expanded}
              onSelect={setSelectedId}
              onToggle={onToggle}
              onAddChild={handleAddChild}
              onDelete={askDelete}
              onMove={handleMove}
            />
          )}
        </div>
      </div>

      {/* 右: 面包屑 + 编辑器 (移动端未选中时让位给页树) */}
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col rounded-xl border bg-card",
          !selectedId && "hidden md:flex",
        )}
      >
        {!selectedId ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
            <FileText className="h-10 w-10 opacity-40" />
            <p className="text-sm">选一个页面开始编辑，或</p>
            <Button variant="outline" onClick={handleNewRoot}>
              <FilePlus2 className="mr-2 h-4 w-4" />
              新建页面
            </Button>
          </div>
        ) : loadedNote && loadedNote.id === selectedId ? (
          <div className="flex h-full flex-col overflow-hidden">
            {/* 面包屑: 移动端含返回; 祖先可点击跳转 */}
            <div className="flex items-center gap-0.5 overflow-x-auto border-b border-border/60 px-2 py-1.5 text-xs text-muted-foreground">
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-accent md:hidden"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                返回
              </button>
              <span className="hidden shrink-0 px-1 md:inline">根</span>
              {ancestors.map((a) => (
                <React.Fragment key={a.id}>
                  <ChevronRight className="h-3 w-3 shrink-0" />
                  <button
                    type="button"
                    onClick={() => setSelectedId(a.id)}
                    className="max-w-[10rem] shrink-0 truncate rounded px-1 py-0.5 hover:bg-accent"
                  >
                    {a.title || "无标题"}
                  </button>
                </React.Fragment>
              ))}
              <ChevronRight className="hidden h-3 w-3 shrink-0 md:inline" />
              <span className="max-w-[12rem] shrink-0 truncate px-1 text-foreground">
                {loadedNote.title || "无标题"}
              </span>
            </div>
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

      {/* 级联删除确认 */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        destructive
        title={`删除「${deleteTarget?.note.title || "无标题"}」?`}
        description={
          deleteTarget && deleteTarget.count > 0
            ? `将一并删除其下 ${deleteTarget.count} 个子页面，可撤销。`
            : "删除后可撤销。"
        }
        confirmLabel="删除"
        onConfirm={() => {
          if (deleteTarget) handleDelete(deleteTarget.note)
        }}
      />
    </div>
  )
}
