"use client"

// 笔记块编辑器封装 (纯客户端) —— 薄包 Plate: 标题 Input + 块文档正文 + 去抖自动保存。
// Notion 感 (slash「/」菜单、拖拽缩进、Markdown 快捷输入) 由 plugins 里的各 Kit 提供, 无需自写。
// 经 notes-manager 以 next/dynamic({ ssr:false }) 懒加载, 避开 SSR 预渲染与静态导出。
import * as React from "react"
import type { Value } from "platejs"
import { Plate, usePlateEditor } from "platejs/react"
import { Editor, EditorContainer } from "@/components/ui/editor"
import { BasicBlocksKit } from "@/components/editor/plugins/basic-blocks-kit"
import { BasicMarksKit } from "@/components/editor/plugins/basic-marks-kit"
import { ListKit } from "@/components/editor/plugins/list-kit"
import { CodeBlockKit } from "@/components/editor/plugins/code-block-kit"
import { SlashKit } from "@/components/editor/plugins/slash-kit"
import { NoteContent } from "../model"
import { updateNote, noteText } from "../lib/notes-store"

/** 一次自动保存后回传给列表的轻量元数据 (用于就地刷新卡片, 免整列表重取)。 */
export type NoteEditorSaved = {
  id: string
  title: string
  excerpt: string
  search: string
  tags: string[]
  updatedAt: number
}

const AUTOSAVE_DELAY = 600

/** 逗号 / 空白分隔解析为标签数组 (与书签一致)。 */
function parseTags(raw: string): string[] {
  return raw
    .split(/[,，\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

export default function NoteEditor({
  noteId,
  initialTitle,
  initialContent,
  initialTags,
  onSaved,
}: {
  noteId: string
  initialTitle: string
  initialContent: NoteContent
  initialTags: string[]
  onSaved?: (meta: NoteEditorSaved) => void
}) {
  const [title, setTitle] = React.useState(initialTitle)
  const [tags, setTags] = React.useState(initialTags.join(", "))

  // 最新值放 ref, 供去抖落库与卸载冲刷读取 (避免把 effect 依赖搞复杂)
  const titleRef = React.useRef(initialTitle)
  const tagsRef = React.useRef(initialTags)
  const contentRef = React.useRef<NoteContent>(initialContent)
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const dirtyRef = React.useRef(false)
  const initialJsonRef = React.useRef(JSON.stringify(initialContent))
  const onSavedRef = React.useRef(onSaved)
  // 提交后同步最新 onSaved (不在 render 期写 ref), 保持 flush 稳定且不依赖 onSaved
  React.useEffect(() => {
    onSavedRef.current = onSaved
  })

  const editor = usePlateEditor({
    plugins: [
      ...BasicBlocksKit,
      ...BasicMarksKit,
      ...ListKit,
      ...CodeBlockKit,
      ...SlashKit,
    ],
    value: initialContent as Value,
  })

  const flush = React.useCallback(async () => {
    timerRef.current = null
    try {
      const saved = await updateNote(noteId, {
        title: titleRef.current,
        content: contentRef.current,
        tags: tagsRef.current,
      })
      if (saved) {
        const text = noteText(saved.content)
        onSavedRef.current?.({
          id: saved.id,
          title: saved.title,
          excerpt: text.slice(0, 160),
          search: text,
          tags: saved.tags,
          updatedAt: saved.updatedAt,
        })
      }
    } catch {
      /* 自动保存失败静默, 下次编辑再试 */
    }
  }, [noteId])

  const schedule = React.useCallback(() => {
    dirtyRef.current = true
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => void flush(), AUTOSAVE_DELAY)
  }, [flush])

  // 卸载 (切换笔记 / 离开页面) 时, 若有未落库的改动立即冲刷
  React.useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        void flush()
      }
    }
  }, [flush])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 标题区: 固定不随正文滚动, 与正文共享同一居中阅读栏宽度 (sm 起约 704px) */}
      <div className="shrink-0 border-b border-border/60 pt-2">
        <input
          value={title}
          onChange={(e) => {
            titleRef.current = e.target.value
            setTitle(e.target.value)
            schedule()
          }}
          autoFocus={!initialTitle}
          placeholder="无标题"
          aria-label="笔记标题"
          className="w-full border-0 bg-transparent px-4 pt-2 text-2xl font-semibold leading-tight outline-none placeholder:text-muted-foreground/40 sm:px-[max(1.5rem,calc(50%-22rem))]"
        />
        <input
          value={tags}
          onChange={(e) => {
            setTags(e.target.value)
            tagsRef.current = parseTags(e.target.value)
            schedule()
          }}
          placeholder="添加标签（逗号分隔）"
          aria-label="笔记标签"
          className="w-full border-0 bg-transparent px-4 pb-3 pt-1.5 text-xs text-muted-foreground outline-none placeholder:text-muted-foreground/40 sm:px-[max(1.5rem,calc(50%-22rem))]"
        />
      </div>
      <Plate
        editor={editor}
        onChange={({ value }) => {
          contentRef.current = value
          // 开局规范化可能触发一次 onChange, 其值与初值相同 → 不算用户编辑, 不刷新 updatedAt
          if (!dirtyRef.current && JSON.stringify(value) === initialJsonRef.current) {
            return
          }
          schedule()
        }}
      >
        <EditorContainer className="min-h-0 flex-1">
          <Editor
            variant="none"
            placeholder="输入正文，输入 / 唤出命令…"
            className="px-4 pt-4 pb-24 text-base leading-relaxed sm:px-[max(1.5rem,calc(50%-22rem))]"
          />
        </EditorContainer>
      </Plate>
    </div>
  )
}
