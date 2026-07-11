// 工作区标签模型 (现代面板式多标签工作区)。
// kind 唯一决定标签内容 (registry 查表)；同 kind(+params) 复用同一标签实例 (id=tabKey)。

// 数据来源模式 (可切换): 本地 = 本机数据; 连接 = 远端服务与联网资源。
// 活动栏按当前 mode 过滤合成根的可见入口；顶栏 ModeSwitch 切换数据镜头。
export type WsMode = "local" | "connected"

/** 工作区是正交于数据来源镜头的 Display 组合；切换时不改变文件、标签或根目录。 */
export type WorkspaceKind = "files" | "audio" | "development"

/** 开发工作区内当前展示的辅助工具。 */
export type DevelopmentTool = "git" | "shell"

export type ModuleId =
  | "home"
  | "subscriptions"
  | "apps"
  | "plugins"
  | "shell"
  | "git"
  | "database"
  | "audio"
  | "code"
  | "trash"
  | "info"
  | "community"
  | "publications"
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
  /** 打开该文件时所在的合成根子树；不参与标签身份。 */
  rootId?: string
}

/** 已打开的标签实例。 */
export type Tab = TabDescriptor & {
  /** 实例 id = kind(+序列化 params)。 */
  id: string
}
