import type { ModuleId, TabDescriptor } from "./types"

export type TabLayout = "padded" | "fill"
export type TabViewType = "overview" | "panel" | "config" | "content"

type TabDefinition = {
  module: ModuleId
  title: string
  path?: string
  layout: TabLayout
  viewType?: TabViewType
}

const TAB_DEFINITIONS = {
  "home-overview": {
    module: "home",
    title: "我的",
    path: "/home",
    layout: "padded",
    viewType: "overview",
  },
  "home-inbox": {
    module: "home",
    title: "收件箱",
    path: "/home/inbox",
    layout: "padded",
  },
  "home-notes": {
    module: "home",
    title: "文件",
    path: "/home/notes",
    layout: "padded",
  },
  // 下列描述符只供内部面板 renderer 使用；持久化标签统一使用 File+Engine。
  subscriptions: {
    module: "subscriptions",
    title: "关注",
    path: "/home/following",
    layout: "padded",
  },
  "home-publications": {
    module: "publications",
    title: "发布",
    path: "/home/publications",
    layout: "padded",
  },
  "home-resources": {
    module: "home",
    title: "资源",
    path: "/home/resources",
    layout: "padded",
  },
  "home-bookmarks": {
    module: "home",
    title: "书签",
    path: "/home/bookmarks",
    layout: "padded",
  },
  "home-settings": {
    module: "home",
    title: "设置",
    path: "/settings/basic",
    layout: "padded",
    viewType: "config",
  },
  info: { module: "info", title: "资讯", path: "/info", layout: "fill" },
  community: { module: "community", title: "社区", path: "/community", layout: "fill" },
  "tool-search": {
    module: "tool",
    title: "搜索",
    path: "/tool/search",
    layout: "padded",
  },
  "tool-ai": {
    module: "tool",
    title: "AI 网站",
    path: "/tool/ai",
    layout: "padded",
  },
  "tool-navigation": {
    module: "tool",
    title: "导航",
    path: "/tool/navigation",
    layout: "padded",
  },
  apps: { module: "apps", title: "应用", path: "/apps/local-apps", layout: "padded" },
  shell: { module: "shell", title: "终端", path: "/shell", layout: "fill" },
  // 以下三项用于 Dock 命令路由；新导航直接创建真实 App root 的 file-engine descriptor。
  git: { module: "git", title: "Git", path: "/git", layout: "padded" },
  database: { module: "database", title: "数据库", path: "/database", layout: "padded" },
  audio: { module: "audio", title: "音频播放器", path: "/audio", layout: "padded" },
  code: { module: "code", title: "Code", path: "/code", layout: "padded" },
  trash: { module: "trash", title: "回收站", path: "/activity/deleted", layout: "padded" },
  "browser-view": {
    module: "browser",
    title: "浏览器",
    path: "/browser",
    layout: "fill",
    viewType: "content",
  },
  "ai-settings": {
    module: "agent",
    title: "AI 设置",
    path: "/settings/ai",
    layout: "fill",
    viewType: "config",
  },
  "ai-mcp": { module: "agent", title: "MCP", layout: "fill", viewType: "config" },
  "ai-skills": { module: "agent", title: "Skills", layout: "fill", viewType: "config" },
  "ai-rules": { module: "agent", title: "规则", layout: "fill", viewType: "config" },
  "ai-tasks": { module: "agent", title: "任务", layout: "fill", viewType: "config" },
  "agent-spaces": {
    module: "agent",
    title: "空间",
    layout: "padded",
    viewType: "config",
  },
  "agent-task-list": {
    module: "agent",
    title: "任务",
    layout: "padded",
    viewType: "config",
  },
} as const satisfies Record<string, TabDefinition>

export type StaticTabKind = keyof typeof TAB_DEFINITIONS

export function isStaticTabKind(kind: string): kind is StaticTabKind {
  return kind in TAB_DEFINITIONS
}

export function tabDescriptor(
  kind: StaticTabKind,
  overrides: Partial<Omit<TabDescriptor, "kind">> = {},
): TabDescriptor {
  const definition: TabDefinition = TAB_DEFINITIONS[kind]
  const descriptor: TabDescriptor = {
    kind,
    module: definition.module,
    title: definition.title,
  }
  if (definition.path) descriptor.path = definition.path
  return { ...descriptor, ...overrides, kind }
}

export function tabDefinitionLayout(kind: string): TabLayout | undefined {
  if (!isStaticTabKind(kind)) return undefined
  const definition: TabDefinition = TAB_DEFINITIONS[kind]
  return definition.layout
}

export function tabDefinitionViewType(kind: string): TabViewType | undefined {
  if (!isStaticTabKind(kind)) return undefined
  const definition: TabDefinition = TAB_DEFINITIONS[kind]
  return definition.viewType ?? "panel"
}
