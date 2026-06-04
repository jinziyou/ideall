/**
 * 回流事件 —— 任何「收入中枢」的写入 (订阅 / 钉工具 / 收藏 / 添加资源) 成功后广播,
 * 让头部的回流计数 badge 实时 +1 并闪一下。属轻量进程内事件, 不落库。
 */
export const HUB_UPDATED = "wonita:hub-updated"

export function notifyHubUpdated() {
  try {
    window.dispatchEvent(new Event(HUB_UPDATED))
  } catch {
    /* SSR / 不支持时忽略 */
  }
}
