// 活动节点端口 (§6.5 对话即文件) —— AI 栏把"用户当前正在看的节点"作隐式上下文, 而不直接依赖 app 层。
// app (workspace) 注册一个读取器 (当前激活标签 → NodeRef); agent 经 getActiveNodeRef() 监听 (守 components↛app 边界)。
// 隐私: 用户打开某节点 = 对其内容的隐式同意 —— 由宿主 (全量访问) 读取并注入上下文, agent 的 MCP 授权集不变
// (仍无 fs.notes:read, 不能批量窥探其它笔记)。
import type { NodeRef } from "@protocol/node"

let getter: (() => NodeRef | null) | null = null

/** app 启动时注册"当前激活节点"读取器。 */
export function registerActiveNode(g: () => NodeRef | null): void {
  getter = g
}

/** 取当前激活的节点引用 (无激活节点标签 / 未注册 → null)。 */
export function getActiveNodeRef(): NodeRef | null {
  return getter ? getter() : null
}
