// 已连接嵌入应用注册表 —— 把嵌入「一方自动授权」做成运行期可见 + 可吊销。
// 兑现 docs/ideall-embed-bridge.md 的「已连接的应用」面板, 补 SECURITY.md 记录的「嵌入自动授权、无运行期吊销面板」缺口。
//
// EmbedHost 建桥时 registerConnection (返回 deregister, 卸载时调); 「已连接的应用」面板订阅快照, 可 revoke。
// 吊销 = 断该实例的 MCP server + 端口 → 此后无任何宿主能力 (越权=工具不存在); 页面仍在, 但失去 host 工具面。
// 纯客户端 UI 状态 (不持久化), useSyncExternalStore 友好 (空集为稳定引用)。

import type { Permission } from "./protocol"

export interface EmbedConnection {
  /** 连接实例 id (同一 app 可多标签 → 多连接); EmbedHost 用 React.useId 等稳定值。 */
  id: string
  /** 嵌入应用 id (manifest.id)。 */
  appId: string
  /** 展示名。 */
  name: string
  /** 嵌入源 origin (授权锚点)。 */
  origin: string
  /** 已授权限位。 */
  permissions: Permission[]
  /** 授予时间 epoch 毫秒。 */
  grantedAt: number
  /** 吊销: 断该实例 MCP 能力面 (由 EmbedHost 提供, 同时翻到「已断开」态)。 */
  revoke: () => void
}

type Listener = () => void

const EMPTY: EmbedConnection[] = []
const connections = new Map<string, EmbedConnection>()
const listeners = new Set<Listener>()
let snapshot: EmbedConnection[] = EMPTY

function emit(): void {
  snapshot =
    connections.size === 0
      ? EMPTY
      : [...connections.values()].sort((a, b) => a.grantedAt - b.grantedAt)
  for (const l of listeners) l()
}

/** EmbedHost 建桥时登记一个连接; 返回 deregister (卸载时调, 幂等)。卸载 ≠ 吊销, 故不触发 revoke。 */
export function registerConnection(c: EmbedConnection): () => void {
  connections.set(c.id, c)
  emit()
  return () => {
    if (connections.delete(c.id)) emit()
  }
}

/** 面板吊销一个连接: 移出注册表并执行其 revoke (幂等; 未知/已撤 id 安全 no-op)。 */
export function revokeConnection(id: string): void {
  const c = connections.get(id)
  if (!c) return
  connections.delete(id)
  emit()
  c.revoke()
}

export function subscribeConnections(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getConnectionsSnapshot(): EmbedConnection[] {
  return snapshot
}

/** SSR / 预渲染期恒空 (连接是客户端运行期状态)。稳定引用避免水合不一致。 */
export function getServerSnapshot(): EmbedConnection[] {
  return EMPTY
}
