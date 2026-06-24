"use client"

// 笔记草稿同步写队列。NoteEditor 的去抖落库 / 卸载冲刷不再直接 await updateNote, 而是**同步**把
// {title,content,tags,onSaved} 推进本队列 (不依赖组件存活), 由独立 worker 串行消费 + 关窗冲刷。
// 即便组件已卸载 / 被 LRU 逐出 / 关窗, 队列项仍在内存, worker 继续消费 → 草稿不随卸载丢失。
//
// 解决 (见 docs/design/ai-native-redesign.md §5.3 雷2): 原 fire-and-forget 卸载 flush 在
// visibilitychange/pagehide 关窗时, 事件循环被掐断, await updateNote 来不及把 microtask 跑到
// IndexedDB 提交点 → 丢草稿。写队列把落库与组件存活解耦, 并显式覆盖关窗边界。
import { noteText, updateNote } from "./notes-store"
import type { NoteEditorSaved } from "@/app/home/notes/note-editor"

type Draft = {
  title: string
  content: unknown[]
  tags: string[]
  onSaved?: (meta: NoteEditorSaved) => void
}

const pending = new Map<string, Draft>() // noteId → 最新草稿 (后写覆盖前写, 天然合并去抖)
let running = false

/** 同步入队 (调用方在 onChange/卸载路径里调, 不 await)。首次入队懒装关窗冲刷。 */
export function enqueueNoteDraft(noteId: string, draft: Draft): void {
  installVisibilityFlush()
  pending.set(noteId, draft)
  void drainQueue()
}

/** 串行消费 worker: 逐条 updateNote 落库, 落库后回调 onSaved (供列表卡片 / 标签标题就地刷新)。 */
async function drainQueue(): Promise<void> {
  if (running) return
  running = true
  try {
    while (pending.size > 0) {
      const noteId = pending.keys().next().value as string
      const draft = pending.get(noteId) as Draft
      let saved
      try {
        saved = await updateNote(noteId, {
          title: draft.title,
          content: draft.content,
          tags: draft.tags,
        })
      } catch {
        break // 落库失败: 留在队列, 下次入队 / 冲刷再试 (不丢)
      }
      // 仅当消费期间未被新草稿覆盖才删 (被覆盖则保留最新待下轮)。
      if (pending.get(noteId) === draft) pending.delete(noteId)
      if (saved && draft.onSaved) {
        const text = noteText(saved.content)
        draft.onSaved({
          id: saved.id,
          title: saved.title,
          excerpt: text.slice(0, 160),
          search: text,
          tags: saved.tags,
          updatedAt: saved.updatedAt,
        })
      }
    }
  } finally {
    running = false
  }
}

/** 逐出 / 卸载前调用 (P1b LRU 用): 若该 note 仍有待落库草稿, await 消费完成 (无则立即 resolve)。 */
export async function flushNode(noteId: string): Promise<void> {
  if (!pending.has(noteId)) return
  await drainQueue()
}

let visibilityInstalled = false
function installVisibilityFlush(): void {
  if (visibilityInstalled || typeof document === "undefined") return
  visibilityInstalled = true
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void drainQueue()
  })
  window.addEventListener("pagehide", () => void drainQueue())
}
