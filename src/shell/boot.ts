// 组合根 (composition root) —— 唯一允许 import 各 app/plugin manifest 的地方。
// 客户端启动时注册进 protocol registry: (1) core 自身实现的 FilesPort; (2) 各 app/plugin
// manifest 贡献的能力 (info/community 的内容解析器、sync 插件的 SyncPort)。
// 使终端外壳 (core) 永不直接依赖具体 app/plugin。
import { registerContentResolver } from "@protocol/content"
import { registerFilesPort } from "@protocol/files"
import { registerUiActions } from "@/lib/ui-actions"
import { registerActiveNode } from "@/lib/active-node"
import { registerBuiltInVfsProviders } from "@/vfs/builtin"
import { isTauri } from "@/lib/tauri"
import { filesPort } from "@/files/files-port"
import {
  openNodeTab,
  closeTab,
  tabKey,
  getActiveId,
  getActiveSource,
  getTabs,
  openAiSettings,
  openAiSection,
  openAiTasks,
} from "@/workspace/store"
import { nodeTab, parseNodeParams } from "@/workspace/node-tab"
import { openInBrowserTab } from "@/workspace/browser-open"
import { infoManifest } from "@/modules/info/manifest"
import { communityManifest } from "@/modules/community/manifest"
import { syncManifest } from "@/plugins/sync/manifest"
import { shellManifest } from "@/plugins/shell/manifest"
import { gitManifest } from "@/plugins/git/manifest"
import { databaseManifest } from "@/plugins/database/manifest"
import { audioManifest } from "@/plugins/audio/manifest"
import { codeManifest } from "@/plugins/code/manifest"

let booted = false

/** 幂等: 注册所有 app/plugin 能力。客户端启动前置步骤 (BootGate) 调一次。 */
export function registerAll(): void {
  if (booted) return
  booted = true
  // 「我的」数据端口 (core 实现, 供 agent 等插件经 protocol 读写「我的」本机数据)。
  registerFilesPort(filesPort)
  // Resource/VFS 挂载点: 本地 node + 连接模式路由型资源。provider 自身保持 UI 无关。
  registerBuiltInVfsProviders()
  // UI 动作端口 (ui.*): 让 agent 经 MCP 把节点打开为工作区标签 (守 components↛app 边界, 由 app 注入)。
  registerUiActions({
    // agent 经 ui.openTab 打开 → source "agent": 该节点不计入「打开即隐式同意」(见下 active-node 守卫), 不改打开行为。
    openTab: (kind, id, title) => openNodeTab({ kind, id }, title, "agent"),
    closeTab: (kind, id) => closeTab(tabKey(nodeTab({ kind, id }, ""))),
    // 外链 → 「浏览器」模块 (插件经 host.external 触达, 守 plugin↛workspace 边界由 app 注入实现)。
    openExternal: (url) => openInBrowserTab(url),
    // AI 区段动作: agent 插件视图经端口打开/关闭 AI 管理标签 (不直接 import 工作区)。
    openAiSettings,
    openAiSection,
    openAiTasks,
    closeAiTasks: (workspaceId) =>
      closeTab(tabKey({ kind: "ai-tasks", module: "agent", title: "", params: { workspaceId } })),
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
  // 插件能力注册 (如 sync 的 SyncPort; shell/git/database/audio/code 视图由 workspace/registry 挂载)。
  for (const p of [
    syncManifest,
    shellManifest,
    gitManifest,
    databaseManifest,
    audioManifest,
    codeManifest,
  ]) {
    p.register?.()
  }
}

/**
 * 客户端启动副作用 (仅客户端, 经 BootGate 的 useEffect 调一次; SSR 预渲染不触发)。
 * 与 registerAll (同步纯注册) 分开: 这里做异步、仅 App 的副作用。
 */
export function bootClientEffects(): void {
  // XState Inspector 由内嵌 XStateInspectorPanel 挂载 iframe 后初始化 (避免 Tauri 弹窗被拦 / 错误 URL)。
  // ACP 暴露自启动: 仅桌面 + 用户已开启时才动态加载 agent 暴露链路并启动监听 ——
  // 关闭时不加载 agent 内核 (acp-settings 轻量, 先查; acp-expose 重, 仅按需 import), 不拖累初始包。
  void (async () => {
    if (!isTauri()) return
    const { getAcpSettings } = await import("@/plugins/agent/lib/acp/acp-settings")
    if (!getAcpSettings().allowEditorConnect) return
    const { autostartAcpServerFromSettings } = await import("@/plugins/agent/lib/acp/acp-expose")
    await autostartAcpServerFromSettings()
  })()
}
