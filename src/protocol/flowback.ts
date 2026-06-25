// 回流契约 —— 任何「收入我的」的写入 (订阅 / 钉工具 / 收藏 / 添加资源) 成功后广播,
// 让「我的」/头部的回流计数实时更新。属轻量进程内事件, 不落库。

export const FILES_UPDATED = "ideall:files-updated"
/** 跨端同步完成事件 (sync 插件在合并写本地后广播)。 */
export const SUBSCRIPTIONS_SYNCED = "wonita:subscriptions-synced"

/** 回流 payload (§7/§9): 哪个 kind 的哪个 id 变了 —— live-merge 据此只重读该条, 不被任何「我的」写惊动。缺省=未知。 */
export type FilesUpdate = { kind?: string; id?: string }

export function notifyFilesUpdated(detail?: FilesUpdate) {
  try {
    window.dispatchEvent(new CustomEvent(FILES_UPDATED, { detail: detail ?? {} }))
  } catch {
    /* SSR / 不支持时忽略 */
  }
}

/** 订阅回流 + 同步完成事件; cb 收到 {kind,id} payload (旧 cb 忽略入参即可)。返回取消订阅函数。SSR 安全。 */
export function onFilesUpdated(cb: (detail?: FilesUpdate) => void): () => void {
  if (typeof window === "undefined") return () => {}
  const h = (e: Event) => cb((e as CustomEvent<FilesUpdate>).detail)
  window.addEventListener(FILES_UPDATED, h)
  window.addEventListener(SUBSCRIPTIONS_SYNCED, h)
  return () => {
    window.removeEventListener(FILES_UPDATED, h)
    window.removeEventListener(SUBSCRIPTIONS_SYNCED, h)
  }
}
