// ACP 暴露服务端的反应式状态 (供 UI 指示) —— 轻量、无重依赖, 由 acp-expose 的生命周期更新。
// useSyncExternalStore: getSnapshot 引用稳定 (内容不变返回同一对象)。
export interface AcpServerStatus {
  /** 是否正在监听入站连接。 */
  listening: boolean
  /** 监听端口 (listening 时); 否则 null。 */
  port: number | null
  /** 当前已连入的外部客户端数。 */
  connections: number
}

const OFF: AcpServerStatus = { listening: false, port: null, connections: 0 }

let state: AcpServerStatus = OFF
const listeners = new Set<() => void>()

export function getAcpServerStatus(): AcpServerStatus {
  return state
}

/** SSR / 预渲染期的稳定快照 (始终 off)。 */
export function getAcpServerStatusServer(): AcpServerStatus {
  return OFF
}

export function subscribeAcpServerStatus(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function setAcpServerStatus(next: AcpServerStatus): void {
  state = next
  for (const l of listeners) l()
}

/** 连接数 +/- (入站连接 open/closed 时调)。 */
export function bumpAcpConnections(delta: number): void {
  if (!state.listening) return
  setAcpServerStatus({ ...state, connections: Math.max(0, state.connections + delta) })
}
