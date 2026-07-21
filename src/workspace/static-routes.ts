/**
 * WorkspaceShell 的静态深链入口。
 *
 * 运行时导航以 FileRef + Engine 为身份，路径只负责静态导出、刷新恢复和兼容已有链接。
 * 因此 app router 只需要一份路径清单，不需要为每个目标维护内容完全相同的 page.tsx。
 */
export const WORKSPACE_STATIC_PATHS = [
  // 我的
  "home",
  "home/inbox",
  "home/following",
  "home/bookmarks",
  "home/resources",
  "home/notes",
  "home/publications",

  // 活动、应用与设置
  "activity/audit",
  "activity/spaces",
  "activity/tasks",
  "activity/deleted",
  "apps/local-apps",
  "settings/basic",
  "settings/ai",

  // 联网资源与本地工具
  "info",
  "info/search",
  "info/entity",
  "info/publisher",
  "info/analysis",
  "community",
  "community/publication",
  "browser",
  "tool",
  "tool/search",
  "tool/ai",
  "tool/navigation",

  // 工作区 Dock 与内置开发工具的兼容入口
  "audio",
  "git",
  "database",
  "shell",
  "code",
] as const

export type WorkspaceStaticPath = (typeof WORKSPACE_STATIC_PATHS)[number]

export function workspaceStaticParams(): Array<{ path: string[] }> {
  return WORKSPACE_STATIC_PATHS.map((path) => ({ path: path.split("/") }))
}
