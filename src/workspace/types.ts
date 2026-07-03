// 工作区标签模型 (现代面板式多标签工作区)。
// kind 唯一决定标签内容 (registry 查表)；同 kind(+params) 复用同一标签实例 (id=tabKey)。

// 工作区模式视图 (可切换): 本机/我的 = 只存本机的个人数据; 连接/发现 = 联网的发现/工具/AI。
// 活动栏按当前 mode 过滤展示哪一簇模块 (见 modules modulesForMode); 顶栏 ModeSwitch 切换视图。
export type WsMode = "local" | "connected"

export type ModuleId =
  | "home"
  | "subscriptions"
  | "apps"
  | "shell"
  | "music"
  | "info"
  | "community"
  | "browser"
  | "tool"
  | "agent"

/** 标签描述符: 打开标签所需的全部信息。 */
export type TabDescriptor = {
  /** registry 键, 如 "home-overview" | "info" | "tool-search"。 */
  kind: string
  /** 归属模块 (驱动活动栏高亮 / 侧栏 / 标签色点)。 */
  module: ModuleId
  /** 标签标题。 */
  title: string
  /** 对应的规范路由 (用于 URL 同步 / 深链 / 刷新恢复)；缺省则不改 URL。 */
  path?: string
  /** 预留: 带参标签 (如 info-entity ?label=&name=)，参与标签去重 key。 */
  params?: Record<string, string>
}

/** 已打开的标签实例。 */
export type Tab = TabDescriptor & {
  /** 实例 id = kind(+序列化 params)。 */
  id: string
}
