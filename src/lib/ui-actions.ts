// UI 动作端口 (ui.*) —— 让消费方 (如 agent 插件经 MCP) 把节点打开为工作区标签, 而不直接依赖 app 层。
// app (workspace) 在启动时注册实现; 插件经 getUiActions() 调用 (与 FilesPort 同范式, 守 components↛app 边界)。
import type { NodeKind } from "@protocol/node"

export interface UiActions {
  /** 打开 (或激活) 一个节点标签。 */
  openTab: (kind: NodeKind, id: string, title: string) => void
  /** 关闭一个节点标签。 */
  closeTab: (kind: NodeKind, id: string) => void
  /** 把外链交给「浏览器」模块打开 (插件外链经此, 不在插件 iframe 内跳转); 无宿主时为 undefined。 */
  openExternal?: (url: string) => void | Promise<void>
  // —— AI 区段动作 (agent 插件视图经端口触达工作区, 守 plugin↛app 边界); 无宿主时为 undefined。 ——
  /** 打开全局 AI 设置标签。 */
  openAiSettings?: () => void
  /** 打开 AI 区段管理标签 (MCP / Skills / 规则)。 */
  openAiSection?: (kind: "ai-mcp" | "ai-skills" | "ai-rules") => void
  /** 打开某工作区的任务标签。 */
  openAiTasks?: (workspaceId: string, title: string) => void
  /** 关闭某工作区的任务标签。 */
  closeAiTasks?: (workspaceId: string) => void
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
