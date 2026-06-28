"use client"

// 节点查看器: 笔记。自取数 + 面包屑导航 + NoteEditor; 标题变更同步标签栏。
import * as React from "react"
import dynamic from "next/dynamic"
import { ChevronRight, Loader2 } from "lucide-react"
import { getNote, getAncestors } from "@/files/stores/notes-store"
import type { Note, NoteMeta } from "@protocol/files"
import { openNodeTab, renameNodeTab } from "../store"
import type { NodeViewerProps } from "../node-viewers"

const NoteEditor = dynamic(() => import("@/modules/home/notes/note-editor"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      编辑器加载中…
    </div>
  ),
})

export default function NoteViewer({ nodeId }: NodeViewerProps) {
  const [note, setNote] = React.useState<Note | null>(null)
  const [ancestors, setAncestors] = React.useState<NoteMeta[]>([])
  const [missing, setMissing] = React.useState(false)

  React.useEffect(() => {
    let alive = true
    Promise.all([getNote(nodeId), getAncestors(nodeId)])
      .then(([n, chain]) => {
        if (!alive) return
        if (n) {
          setNote(n)
          setAncestors(chain)
        } else setMissing(true)
      })
      .catch(() => {
        if (alive) setMissing(true)
      })
    return () => {
      alive = false
    }
  }, [nodeId])

  if (missing) {
    return <div className="p-6 text-sm text-muted-foreground">该笔记不存在或已删除。</div>
  }
  if (!note) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {ancestors.length > 0 && (
        <div className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border/60 px-3 py-1.5 text-xs text-muted-foreground">
          <span className="shrink-0 px-1">根</span>
          {ancestors.map((a) => (
            <React.Fragment key={a.id}>
              <ChevronRight className="h-3 w-3 shrink-0" />
              <button
                type="button"
                onClick={() => openNodeTab({ kind: "note", id: a.id }, a.title || "无标题")}
                className="max-w-[10rem] shrink-0 truncate rounded px-1 py-0.5 hover:bg-accent"
              >
                {a.title || "无标题"}
              </button>
            </React.Fragment>
          ))}
          <ChevronRight className="h-3 w-3 shrink-0" />
          <span className="max-w-[12rem] shrink-0 truncate px-1 text-foreground">
            {note.title || "无标题"}
          </span>
        </div>
      )}
      <NoteEditor
        key={note.id}
        noteId={note.id}
        initialTitle={note.title}
        initialContent={note.content}
        initialTags={note.tags}
        onSaved={(meta) => renameNodeTab({ kind: "note", id: note.id }, meta.title || "无标题")}
      />
    </div>
  )
}
