// UI 动作端口 (ui.*) —— 让消费方 (如 agent 插件经 MCP) 把节点物化为工作区标签, 而不直接依赖 app 层。
// app (workspace) 在启动时注册实现; 插件经 getUiActions() 调用 (与 HubDataPort 同范式, 守 components↛app 边界)。
import type { NodeKind } from "@protocol/node"

export interface UiActions {
  /** 打开 (或激活) 一个节点标签。 */
  openTab: (kind: NodeKind, id: string, title: string) => void
  /** 关闭一个节点标签。 */
  closeTab: (kind: NodeKind, id: string) => void
}

let actions: UiActions | null = null

/** app 启动时注册 UI 动作实现 (workspace store)。 */
export function registerUiActions(a: UiActions): void {
  actions = a
}

/** 取 UI 动作 (插件用); 未注册 (无 workspace 宿主) 时为 null, 调用方降级为不开标签。 */
export function getUiActions(): UiActions | null {
  return actions
}
