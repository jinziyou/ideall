// 宿主侧栏 → 嵌入 iframe 内路由 (uiPort navigated 事件, 见 ideall-embed-bridge.md §8)。

export type EmbedAppId = "info" | "community"

const navigators = new Map<string, (route: string) => void>()

/** EmbedHost 建桥后登记 navigated 发送器; 返回注销函数。 */
export function registerEmbedNavigator(appId: string, send: (route: string) => void): () => void {
  navigators.set(appId, send)
  return () => {
    if (navigators.get(appId) === send) navigators.delete(appId)
  }
}

/** 请求嵌入应用内导航 (侧栏点选关注项等); 桥未就绪时静默忽略。 */
export function requestEmbedRoute(appId: EmbedAppId, route: string): void {
  navigators.get(appId)?.(route)
}
