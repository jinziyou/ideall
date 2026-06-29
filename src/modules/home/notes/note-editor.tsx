"use client"

// 笔记块编辑器封装 (纯客户端) —— 薄包 Plate: 标题 Input + 块文档正文 + 去抖自动保存。
// Notion 感 (slash「/」菜单、拖拽缩进、Markdown 快捷输入) 由 plugins 里的各 Kit 提供, 无需自写。
// 经 notes-manager 以 next/dynamic({ ssr:false }) 懒加载, 避开 SSR 预渲染与静态导出。
import * as React from "react"
import type { Value } from "platejs"
import { NodeIdPlugin } from "platejs"
import { Plate, usePlateEditor } from "platejs/react"
import { genId } from "@/lib/id"
import { Editor, EditorContainer } from "@/ui/editor"
import { BasicBlocksKit } from "@/ui/editor/plugins/basic-blocks-kit"
import { BasicMarksKit } from "@/ui/editor/plugins/basic-marks-kit"
import { ListKit } from "@/ui/editor/plugins/list-kit"
import { CodeBlockKit } from "@/ui/editor/plugins/code-block-kit"
import { SlashKit } from "@/ui/editor/plugins/slash-kit"
import { NoteContent } from "@protocol/files"
import { enqueueNoteDraft } from "@/files/note-write-queue"
// 保存回传元数据类型下沉到数据层 (写队列是其产出方); 此处再导出以兼容现有 ./note-editor 引用。
import type { NoteEditorSaved } from "@/files/note-write-queue"
export type { NoteEditorSaved }

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
  onDirty,
}: {
  noteId: string
  initialTitle: string
  initialContent: NoteContent
  initialTags: string[]
  onSaved?: (meta: NoteEditorSaved) => void
  /** 首次用户编辑时回调一次 (供「编辑即钉住」: 把预览标签提升为常驻)。 */
  onDirty?: () => void
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
  const onDirtyRef = React.useRef(onDirty)
  // 提交后同步最新 onSaved/onDirty (不在 render 期写 ref), 保持 flush/schedule 稳定且不依赖它们
  React.useEffect(() => {
    onSavedRef.current = onSaved
    onDirtyRef.current = onDirty
  })

  const editor = usePlateEditor({
    // NodeIdPlugin (§7.2): 顶层块稳定 id (新块用 genId("blk"); 加载内容已由 notes-store 播种 id, 此处保留 +
    // 为新块补 id) —— 块级并发合并 (blockMeta) 据此跨编辑/跨端对齐同一块。
    plugins: [
      ...BasicBlocksKit,
      ...BasicMarksKit,
      ...ListKit,
      ...CodeBlockKit,
      ...SlashKit,
      NodeIdPlugin.configure({ options: { idCreator: () => genId("blk") } }),
    ],
    value: initialContent as Value,
  })

  // 落库交给同步写队列 (note-write-queue): 同步入队最新草稿, 由独立 worker 串行消费 + 关窗冲刷。
  // 与组件存活解耦 → 切笔记 / 卸载 / 被 LRU 逐出 / 关窗都不丢草稿。onSaved 由 worker 落库后回调。
  const flush = React.useCallback(() => {
    timerRef.current = null
    enqueueNoteDraft(noteId, {
      title: titleRef.current,
      content: contentRef.current,
      tags: tagsRef.current,
      onSaved: onSavedRef.current,
    })
  }, [noteId])

  const schedule = React.useCallback(() => {
    if (!dirtyRef.current) {
      dirtyRef.current = true
      onDirtyRef.current?.() // 首次用户编辑 → 通知外层 (编辑即钉住)
    }
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(flush, AUTOSAVE_DELAY)
  }, [flush])

  // 卸载 (切换笔记 / 离开页面) 时, 若有未落库的改动同步入队 (worker 在卸载后继续消费)。
  React.useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        flush()
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
