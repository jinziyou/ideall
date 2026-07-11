"use client"

// 节点查看器: 笔记。经 FileSystem 取数 + 面包屑导航 + NoteEditor; 标题变更同步标签栏。
import * as React from "react"
import dynamic from "next/dynamic"
import { ChevronRight, Loader2 } from "lucide-react"
import { openTarget, renameNodeTab, promoteActiveTab } from "../store"
import type { NodeViewerProps } from "../node-kind-ui"
import { resourceFileRef } from "@/filesystem/resource-file-system"
import { readNodeFile, useNodeFile } from "./use-node-file"

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
  const { node: note, loading, missing, error } = useNodeFile("note", nodeId)
  const [ancestors, setAncestors] = React.useState<Array<{ id: string; title: string }>>([])

  React.useEffect(() => {
    if (!note) {
      setAncestors([])
      return
    }
    let alive = true
    void (async () => {
      const chain: Array<{ id: string; title: string }> = []
      const seen = new Set([note.id])
      let parentId = note.parentId
      while (parentId && !seen.has(parentId)) {
        seen.add(parentId)
        const parent = await readNodeFile("note", parentId)
        if (!parent) break
        chain.unshift({ id: parent.id, title: parent.title })
        parentId = parent.parentId
      }
      if (alive) setAncestors(chain)
    })().catch(() => {
      if (alive) setAncestors([])
    })
    return () => {
      alive = false
    }
  }, [note])

  React.useEffect(() => {
    if (note) renameNodeTab({ kind: "note", id: note.id }, note.title || "无标题")
  }, [note])

  if (missing) {
    return <div className="p-6 text-sm text-muted-foreground">该笔记不存在或已删除。</div>
  }
  if (error) {
    return <div className="p-6 text-sm text-muted-foreground">笔记读取失败。</div>
  }
  if (loading || !note) {
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
                onClick={() =>
                  openTarget({
                    type: "file",
                    ref: resourceFileRef({ scheme: "node", kind: "note", id: a.id }),
                    title: a.title || "无标题",
                    rootId: "notes",
                  })
                }
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
        onDirty={promoteActiveTab}
      />
    </div>
  )
}
