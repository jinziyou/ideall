"use client"

// 「我的 → 笔记」区段的侧栏页树 (唯一入口): 展开/新建/删除/拖拽, 选中 → 开内容标签。
import * as React from "react"
import { toast } from "sonner"
import { ConfirmDialog } from "@/shared/prompt-dialog"
import { undoableDeleteToast } from "@/lib/undo-toast"
import type { NoteMeta } from "@protocol/files"
import {
  addNote,
  deleteNote,
  listNotes,
  moveNote,
  restoreSubtree,
} from "@/files/stores/notes-store"
import { PageTree, type InsertPos } from "./notes-tree"
import { openNodeTab, useActiveId, getTabs } from "@/workspace/store"
import { parseNodeParams } from "@/workspace/node-tab"
import { refreshSidebarTree, subscribeSidebarTreeRefresh } from "@/workspace/tree/sidebar-tree-bus"

const EXPANDED_KEY = "ideall:notes:sidebar-expanded"

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

function activeNoteId(activeId: string | null): string | null {
  if (!activeId) return null
  const t = getTabs().find((x) => x.id === activeId)
  if (!t || t.kind !== "node") return null
  const ref = parseNodeParams(t.params)
  return ref?.kind === "note" ? ref.id : null
}

export default function NotesSidebarTree({ depth = 1 }: { depth?: number }) {
  const activeId = useActiveId()
  const selectedId = activeNoteId(activeId)

  const [notes, setNotes] = React.useState<NoteMeta[]>([])
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

  React.useEffect(() => {
    let alive = true
    ;(async () => {
      let saved: Set<string> | null = null
      try {
        const raw = localStorage.getItem(EXPANDED_KEY)
        if (raw) saved = new Set(JSON.parse(raw) as string[])
      } catch {
        /* ignore */
      }
      try {
        const n = await listNotes()
        if (!alive) return
        setNotes(n)
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

  React.useEffect(() => subscribeSidebarTreeRefresh(() => void reload()), [reload])

  React.useEffect(() => {
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expanded]))
    } catch {
      /* ignore */
    }
  }, [expanded])

  const onToggle = React.useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const handleSelect = React.useCallback(
    (id: string) => {
      const note = notes.find((n) => n.id === id)
      openNodeTab({ kind: "note", id }, note?.title || "无标题")
    },
    [notes],
  )

  async function handleAddChild(parentId: string) {
    try {
      const note = await addNote({ parentId })
      await reload()
      refreshSidebarTree()
      setExpanded((prev) => new Set(prev).add(parentId))
      openNodeTab({ kind: "note", id: note.id }, note.title || "无标题")
    } catch (e) {
      toast.error("新建子页失败", { description: String(e) })
    }
  }

  async function handleMove(dragId: string, newParentId: string | null, pos?: InsertPos) {
    try {
      await moveNote(dragId, newParentId, pos)
      if (newParentId) setExpanded((prev) => new Set(prev).add(newParentId))
      await reload()
      refreshSidebarTree()
    } catch (e) {
      toast.error("移动失败", { description: String(e) })
    }
  }

  function askDelete(note: NoteMeta) {
    setDeleteTarget({ note, count: countDescendants(notes, note.id) })
  }

  async function handleDelete(note: NoteMeta) {
    try {
      const captured = await deleteNote(note.id)
      await reload()
      refreshSidebarTree()
      if (captured.length) {
        undoableDeleteToast(note.title || "无标题", async () => {
          await restoreSubtree(captured)
          await reload()
          refreshSidebarTree()
        })
      }
    } catch (e) {
      toast.error("删除失败", { description: String(e) })
    }
  }

  return (
    <>
      <div style={{ paddingLeft: `${depth * 12 + 4}px` }}>
        <PageTree
          notes={notes}
          selectedId={selectedId}
          expanded={expanded}
          onSelect={handleSelect}
          onToggle={onToggle}
          onAddChild={handleAddChild}
          onDelete={askDelete}
          onMove={handleMove}
        />
      </div>
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
    </>
  )
}
