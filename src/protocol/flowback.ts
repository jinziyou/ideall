// 回流契约 —— 任何「收入中枢」的写入 (订阅 / 钉工具 / 收藏 / 添加资源) 成功后广播,
// 让中枢/头部的回流计数实时更新。属轻量进程内事件, 不落库。

export const HUB_UPDATED = "wonita:hub-updated"
/** 跨端同步完成事件 (sync 插件在合并写本地后广播)。 */
export const SUBSCRIPTIONS_SYNCED = "wonita:subscriptions-synced"

export function notifyHubUpdated() {
  try {
    window.dispatchEvent(new Event(HUB_UPDATED))
  } catch {
    /* SSR / 不支持时忽略 */
  }
}

/** 订阅回流 + 同步完成事件; 返回取消订阅函数。SSR 安全 (无 window 时为 no-op)。 */
export function onHubUpdated(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {}
  window.addEventListener(HUB_UPDATED, cb)
  window.addEventListener(SUBSCRIPTIONS_SYNCED, cb)
  return () => {
    window.removeEventListener(HUB_UPDATED, cb)
    window.removeEventListener(SUBSCRIPTIONS_SYNCED, cb)
  }
}
