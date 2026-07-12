"use client"

// 笔记草稿同步写队列。NoteEditor 的去抖落库 / 卸载冲刷不再直接 await updateNote, 而是**同步**把
// {title,content,tags,onSaved} 推进本队列 (不依赖组件存活), 由独立 worker 串行消费 + 关窗冲刷。
// 即便组件已卸载 / 被 LRU 逐出 / 关窗, 队列项仍在内存, worker 继续消费 → 草稿不随卸载丢失。
//
// 解决 (见 docs/design/archive/ai-native-redesign.md §5.3 雷2): 原 fire-and-forget 卸载 flush 在
// visibilitychange/pagehide 关窗时, 事件循环被掐断, await updateNote 来不及把 microtask 跑到
// IndexedDB 提交点 → 丢草稿。写队列把落库与组件存活解耦, 并显式覆盖关窗边界。
//
// 保存状态可见性 (本地优先产品的信任面): 队列对外暴露每个 noteId 的保存状态
// (saving/saved/error, useSyncExternalStore 订阅), 编辑器渲染「保存中/已保存/保存失败」;
// 落库失败不再静默 —— 指数退避自动重试, 且首次进入失败态 toast 一次 (编辑器可能已被 LRU 逐出,
// 此时 toast 是唯一可见通道; 成功后复位)。
import { toast } from "sonner"
import { writeFile } from "@/filesystem/registry"
import { resourceFileRef } from "@/filesystem/resource-file-system"
import { noteText } from "@/files/note-text"

const UI_WRITE_CONTEXT = { actor: "ui", permissions: [], intent: "write" } as const

/** 一次落库后回传给列表的轻量元数据 (用于就地刷新卡片, 免整列表重取)。写队列是其产出方, 故类型在此自有定义。 */
export type NoteEditorSaved = {
  id: string
  title: string
  excerpt: string
  search: string
  tags: string[]
  updatedAt: number
}

type Draft = {
  title: string
  content: unknown[]
  tags: string[]
  onSaved?: (meta: NoteEditorSaved) => void
}

const pending = new Map<string, Draft>() // noteId → 最新草稿 (后写覆盖前写, 天然合并去抖)
let running = false

// —— 保存状态 (对 UI 可见) ——

export type NoteSaveState = "idle" | "saving" | "saved" | "error"
export type NoteSaveStatus = { state: NoteSaveState; savedAt: number | null }

const IDLE_STATUS: NoteSaveStatus = { state: "idle", savedAt: null }
const statuses = new Map<string, NoteSaveStatus>()
const statusListeners = new Set<() => void>()

function setStatus(noteId: string, state: NoteSaveState) {
  const prev = statuses.get(noteId)
  if (prev?.state === state && state !== "saved") return
  statuses.set(noteId, {
    state,
    savedAt: state === "saved" ? Date.now() : (prev?.savedAt ?? null),
  })
  for (const l of statusListeners) l()
}

export function subscribeNoteSaveStatus(l: () => void): () => void {
  statusListeners.add(l)
  return () => {
    statusListeners.delete(l)
  }
}

/** 某笔记的保存状态快照 (无记录 → 稳定的 idle 常量, useSyncExternalStore 安全)。 */
export function getNoteSaveStatus(noteId: string): NoteSaveStatus {
  return statuses.get(noteId) ?? IDLE_STATUS
}

/** 编辑器在用户输入 (去抖计时开始) 时调用: 立即呈现「保存中」, 不等 600ms 后的真实入队。 */
export function markNoteDirty(noteId: string): void {
  const s = statuses.get(noteId)?.state
  if (s !== "saving") setStatus(noteId, "saving")
}

// —— 失败重试 (指数退避) ——

const RETRY_BASE_MS = 2_000
const RETRY_MAX_MS = 30_000
let retryDelay = RETRY_BASE_MS
let retryTimer: ReturnType<typeof setTimeout> | null = null
let failureToasted = false // 一次失败态只 toast 一次, 成功后复位

function scheduleRetry(): void {
  if (retryTimer) return
  const delay = retryDelay
  retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS)
  retryTimer = setTimeout(() => {
    retryTimer = null
    void drainQueue()
  }, delay)
}

/** 立即重试 (UI「重试」按钮): 取消退避计时, 复位延迟, 马上消费。 */
export function retryNoteSaves(): void {
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
  retryDelay = RETRY_BASE_MS
  void drainQueue()
}

function notifyFailureOnce(): void {
  if (failureToasted) return
  failureToasted = true
  toast.error("笔记保存失败", {
    description: "草稿仍在本机内存中，正在自动重试。请检查存储空间（隐私模式下无法落库）。",
    duration: 10_000,
    action: { label: "立即重试", onClick: retryNoteSaves },
  })
}

/** 同步入队 (调用方在 onChange/卸载路径里调, 不 await)。首次入队懒装关窗冲刷。 */
export function enqueueNoteDraft(noteId: string, draft: Draft): void {
  installVisibilityFlush()
  pending.set(noteId, draft)
  setStatus(noteId, "saving")
  void drainQueue()
}

/** 串行消费 worker: 逐条经 FileSystem 落库, 落库后回调 onSaved。 */
async function drainQueue(): Promise<void> {
  if (running) return
  running = true
  try {
    while (pending.size > 0) {
      const noteId = pending.keys().next().value as string
      const draft = pending.get(noteId) as Draft
      let savedAt = Date.now()
      try {
        const saved = await writeFile(
          resourceFileRef({ scheme: "node", kind: "note", id: noteId }),
          {
            data: {
              title: draft.title,
              content: draft.content,
              tags: draft.tags,
            },
          },
          UI_WRITE_CONTEXT,
        )
        savedAt = saved.updatedAt ?? savedAt
      } catch {
        // 落库失败: 留在队列不丢; 状态转 error + 指数退避自动重试 + 首次失败 toast (不再静默)。
        setStatus(noteId, "error")
        notifyFailureOnce()
        scheduleRetry()
        break
      }
      // 仅当消费期间未被新草稿覆盖才删 (被覆盖则保留最新待下轮)。
      if (pending.get(noteId) === draft) {
        pending.delete(noteId)
        setStatus(noteId, "saved")
      }
      retryDelay = RETRY_BASE_MS
      failureToasted = false
      if (draft.onSaved) {
        const text = noteText(draft.content)
        draft.onSaved({
          id: noteId,
          title: draft.title,
          excerpt: text.slice(0, 160),
          search: text,
          tags: draft.tags,
          updatedAt: savedAt,
        })
      }
    }
  } finally {
    running = false
  }
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
