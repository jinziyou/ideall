"use client"

// AI 对话栏的轻量命令总线: 外部入口 (thread-viewer「继续此对话」等) → 右栏 AgentPanel。
// 面板可能尚未挂载 (首次呼出右栏时才 mount), 故除事件外还留一个 pending 槽:
// 面板挂载时消费一次, 保证「先请求、后挂载」不丢命令。

const OPEN_THREAD_EVENT = "ideall:agent:open-thread"

let pendingThreadId: string | null = null

/** 请求右栏 AI 面板切换到指定对话 (调用方自行负责先 setRightPanel(true))。 */
export function requestOpenThread(id: string): void {
  pendingThreadId = id
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<string>(OPEN_THREAD_EVENT, { detail: id }))
  }
}

/** 面板挂载时消费未处理的打开请求 (一次性)。 */
export function consumePendingOpenThread(): string | null {
  const id = pendingThreadId
  pendingThreadId = null
  return id
}

/** 订阅打开请求 (面板已挂载时的实时通道)。 */
export function onOpenThreadRequest(handler: (id: string) => void): () => void {
  const listener = (e: Event) => {
    pendingThreadId = null // 实时处理即消费, 防挂载路径重复处理
    handler((e as CustomEvent<string>).detail)
  }
  window.addEventListener(OPEN_THREAD_EVENT, listener)
  return () => window.removeEventListener(OPEN_THREAD_EVENT, listener)
}
