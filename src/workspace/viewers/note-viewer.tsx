"use client"

// 节点查看器: 笔记。自取数 (getNote) + 渲染受控 NoteEditor (锁定 5-prop) + onSaved 实时回填标签标题。
// NoteEditor 经 next/dynamic({ssr:false}) 懒加载, 与 notes-manager 同范式 (避开 SSR / 静态导出预渲染)。
// 落库 (去抖自动保存 / 卸载冲刷) 沿用 NoteEditor 既有逻辑; 写队列 / LRU / 块级合并是后续阶段。
import * as React from "react"
import dynamic from "next/dynamic"
import { Loader2 } from "lucide-react"
import { getNote } from "@/files/stores/notes-store"
import type { Note } from "@/modules/home/model"
import { renameNodeTab } from "../store"
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
  const [missing, setMissing] = React.useState(false)

  // nodeId 对单个查看器实例恒定 (每个节点标签在 tab-host 是独立 keep-alive 实例), 故无需重置态。
  React.useEffect(() => {
    let alive = true
    getNote(nodeId)
      .then((n) => {
        if (!alive) return
        if (n) setNote(n)
        else setMissing(true)
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
    <NoteEditor
      key={note.id}
      noteId={note.id}
      initialTitle={note.title}
      initialContent={note.content}
      initialTags={note.tags}
      onSaved={(meta) => renameNodeTab({ kind: "note", id: note.id }, meta.title || "无标题")}
    />
  )
}
