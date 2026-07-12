// 「我的」写入事件接口约定 —— 任何「加入我的」的写入 (关注 / 固定工具 / 收藏 / 添加资源) 成功后广播,
// 让「我的」/头部的「我的」计数实时更新。属轻量进程内事件, 不落库。

export const FILES_UPDATED = "ideall:files-updated"
/** 跨端同步完成事件 (sync 插件在合并写本地后广播); 同时监听旧 wonita 事件名以兼容已加载旧窗口。 */
export const SUBSCRIPTIONS_SYNCED = "ideall:subscriptions-synced"
const LEGACY_SUBSCRIPTIONS_SYNCED = "wonita:subscriptions-synced"

/** 写入 payload (§7/§9): 哪个 kind 的哪个 id 变了 —— live-merge 据此只重读该条, 不被任何「我的」写惊动。缺省=未知。 */
export type FilesUpdate = { kind?: string; id?: string; subType?: string }

export function notifyFilesUpdated(detail?: FilesUpdate) {
  try {
    window.dispatchEvent(new CustomEvent(FILES_UPDATED, { detail: detail ?? {} }))
  } catch {
    /* SSR / 不支持时忽略 */
  }
}

/** 「我的」写入 + 同步完成事件; cb 收到 {kind,id} payload (旧 cb 忽略入参即可)。返回取消监听函数。SSR 安全。 */
export function onFilesUpdated(cb: (detail?: FilesUpdate) => void): () => void {
  if (typeof window === "undefined") return () => {}
  const h = (e: Event) => cb((e as CustomEvent<FilesUpdate>).detail)
  window.addEventListener(FILES_UPDATED, h)
  window.addEventListener(SUBSCRIPTIONS_SYNCED, h)
  window.addEventListener(LEGACY_SUBSCRIPTIONS_SYNCED, h)
  return () => {
    window.removeEventListener(FILES_UPDATED, h)
    window.removeEventListener(SUBSCRIPTIONS_SYNCED, h)
    window.removeEventListener(LEGACY_SUBSCRIPTIONS_SYNCED, h)
  }
}
