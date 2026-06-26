// 组合根 (composition root) —— 唯一允许 import 各 app/plugin manifest 的地方。
// 客户端启动时注册进 protocol registry: (1) core 自身实现的 FilesPort; (2) 各 app/plugin
// manifest 贡献的能力 (info/community 的内容解析器、sync 插件的 SyncPort)。
// 使终端外壳 (core) 永不直接依赖具体 app/plugin。
import { registerContentResolver } from "@protocol/content"
import { registerFilesPort } from "@protocol/files"
import { registerUiActions } from "@/lib/ui-actions"
import { registerActiveNode } from "@/lib/active-node"
import { filesPort } from "@/files/files-port"
import { openNodeTab, closeTab, tabKey, getActiveId, getActiveSource, getTabs } from "@/workspace/store"
import { nodeTab, parseNodeParams } from "@/workspace/node-tab"
import { infoManifest } from "@/modules/info/manifest"
import { communityManifest } from "@/modules/community/manifest"
import { syncManifest } from "@/plugins/sync/manifest"

let booted = false

/** 幂等: 注册所有 app/plugin 能力。客户端启动闸 (BootGate) 调一次。 */
export function registerAll(): void {
  if (booted) return
  booted = true
  // 「我的」数据端口 (core 实现, 供 agent 等插件经 protocol 读写「我的」本机数据)。
  registerFilesPort(filesPort)
  // UI 动作端口 (ui.*): 让 agent 经 MCP 把节点物化为工作区标签 (守 components↛app 边界, 由 app 注入)。
  registerUiActions({
    // agent 经 ui.openTab 打开 → source "agent": 该节点不计入「打开即隐式同意」(见下 active-node 守卫), 不改打开行为。
    openTab: (kind, id, title) => openNodeTab({ kind, id }, title, "agent"),
    closeTab: (kind, id) => closeTab(tabKey(nodeTab({ kind, id }, ""))),
  })
  // 活动节点端口 (§6.5 对话即文件): 当前激活的节点标签 → NodeRef, 供 AI 栏作隐式上下文。
  // 隐私守卫: 仅当激活来源为 user 时回 NodeRef; agent 经 ui.openTab 自激活的节点回 null ——
  // 否则 agent 可 ui.openTab 任意笔记 → 下一轮 gatherReferencedContext 自喂其正文给模型端点, 软绕 fs.notes:read consent。
  registerActiveNode(() => {
    const id = getActiveId()
    const tab = getTabs().find((t) => t.id === id)
    if (!tab || tab.kind !== "node" || getActiveSource() !== "user") return null
    return parseNodeParams(tab.params)
  })
  for (const m of [infoManifest, communityManifest]) {
    for (const r of m.resolvers ?? []) registerContentResolver(r.types, r.resolve)
  }
  // 插件能力注册 (如 sync 的 SyncPort)。
  for (const p of [syncManifest]) p.register?.()
}
