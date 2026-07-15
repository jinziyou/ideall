// 旧模块目录保留给 toggleModule、路由→标签解析与插件兼容，不再驱动可见导航。
// 桌面活动栏/侧栏和移动抽屉统一由 navigation-sections.ts 驱动；shell/nav-config.ts
// 只服务仍采用 href 的底栏与命令面板。
// 「搜索」是跳转外部搜索引擎的聚合工具；顶栏搜索框/⌘K 搜索本机内容，职责不同。

import type { ComponentType } from "react"
import { Bot, Compass, Globe, Hexagon, Search } from "lucide-react"
import type { ModuleId, TabDescriptor } from "./types"
import { MODULE_META } from "./module-meta"
import { PLUGIN_ENTRIES } from "./plugin-entries"
import { tabDescriptor } from "./tab-definitions"
import { descriptorForResourceSearch } from "./open-target"
import { resourceFileTab } from "./resource-file-tab"
import { fileEngineTab } from "./file-tab"
import { directorySurface, type DirectorySurfaceId } from "./directory-surfaces"

export type SidebarEntry = {
  label: string
  icon: ComponentType<{ className?: string }>
  descriptor: TabDescriptor
}

export type ModuleConfig = {
  id: ModuleId
  label: string
  icon: ComponentType<{ className?: string }>
  /** 分区色 (text-*), 仅用于图标着色, 不大面积 fill。 */
  colorClass?: string
  sidebarTitle: string
  entries: SidebarEntry[]
}

function directorySurfaceDescriptor(id: DirectorySurfaceId, title: string): TabDescriptor {
  const surface = directorySurface(id)
  return fileEngineTab({ ref: surface.ref, name: title }, surface.engineId, {
    module: surface.module,
    rootId: surface.rootId,
    path: surface.navigationPath,
    navigationPath: surface.navigationPath,
  })
}

const homeEntries: SidebarEntry[] = [
  {
    label: MODULE_META.overview.label,
    icon: MODULE_META.overview.icon,
    descriptor: tabDescriptor("home-overview"),
  },
  {
    label: MODULE_META.notes.label,
    icon: MODULE_META.notes.icon,
    descriptor: tabDescriptor("home-notes"),
  },
  {
    label: MODULE_META.resources.label,
    icon: MODULE_META.resources.icon,
    descriptor: directorySurfaceDescriptor("resources", MODULE_META.resources.label),
  },
  {
    // 「我的」语境下的书签区段 (底层仍是 bookmark 节点)。
    label: MODULE_META.bookmarks.label,
    icon: MODULE_META.bookmarks.icon,
    descriptor: directorySurfaceDescriptor("bookmarks", MODULE_META.bookmarks.label),
  },
]

export const MODULES: ModuleConfig[] = [
  {
    id: "home",
    label: "我的",
    icon: Hexagon,
    sidebarTitle: "我的",
    entries: homeEntries,
  },
  {
    // 关注 = 全部动态来源 (发布者 / 实体 / 搜索 / 社区发布者 peer) 的统一入口; 内容汇入「我的」。
    // 旧的「关注」(资讯源) 与「关注」(社区 peer) 两个入口已合并到这里。
    id: "subscriptions",
    label: MODULE_META.subscriptions.label,
    icon: MODULE_META.subscriptions.icon,
    colorClass: MODULE_META.subscriptions.tintClass,
    sidebarTitle: "关注",
    entries: [
      {
        label: "关注流",
        icon: MODULE_META.subscriptions.icon,
        descriptor: directorySurfaceDescriptor("subscriptions", MODULE_META.subscriptions.label),
      },
    ],
  },
  {
    id: "apps",
    label: MODULE_META.apps.label,
    icon: MODULE_META.apps.icon,
    colorClass: MODULE_META.apps.tintClass,
    sidebarTitle: "应用",
    entries: [
      {
        label: "全部应用",
        icon: MODULE_META.apps.icon,
        descriptor: directorySurfaceDescriptor("installed-apps", MODULE_META.apps.label),
      },
    ],
  },
  {
    id: "plugins",
    label: MODULE_META.plugins.label,
    icon: MODULE_META.plugins.icon,
    colorClass: MODULE_META.plugins.tintClass,
    sidebarTitle: "插件",
    entries: PLUGIN_ENTRIES.map(({ label, icon, descriptor }) => ({ label, icon, descriptor })),
  },
  {
    id: "trash",
    label: MODULE_META.trash.label,
    icon: MODULE_META.trash.icon,
    colorClass: MODULE_META.trash.tintClass,
    sidebarTitle: "回收站",
    entries: [
      {
        label: MODULE_META.trash.label,
        icon: MODULE_META.trash.icon,
        descriptor: directorySurfaceDescriptor("trash", MODULE_META.trash.label),
      },
    ],
  },
  {
    id: "info",
    label: MODULE_META.info.label,
    icon: MODULE_META.info.icon,
    colorClass: MODULE_META.info.tintClass,
    sidebarTitle: "资讯",
    entries: [
      {
        label: "资讯主页",
        icon: MODULE_META.info.icon,
        descriptor: resourceFileTab({ scheme: "info", kind: "home", id: "default" }, "资讯"),
      },
    ],
  },
  {
    id: "community",
    label: MODULE_META.community.label,
    icon: MODULE_META.community.icon,
    colorClass: MODULE_META.community.tintClass,
    sidebarTitle: "社区",
    entries: [
      {
        label: "社区主页",
        icon: MODULE_META.community.icon,
        descriptor: resourceFileTab({ scheme: "community", kind: "home", id: "default" }, "社区"),
      },
    ],
  },
  {
    id: "publications",
    label: MODULE_META.publications.label,
    icon: MODULE_META.publications.icon,
    colorClass: MODULE_META.publications.tintClass,
    sidebarTitle: "发布",
    entries: [
      {
        label: "我的发布",
        icon: MODULE_META.publications.icon,
        descriptor: tabDescriptor("home-publications"),
      },
    ],
  },
  {
    id: "tool",
    label: MODULE_META.tool.label,
    icon: MODULE_META.tool.icon,
    colorClass: MODULE_META.tool.tintClass,
    sidebarTitle: "工具",
    entries: [
      {
        // 聚合搜索 (选引擎输词跳转外部搜索引擎); 与顶栏搜索框/⌘K 统一面板职责分离: 前者跳外部引擎, 后者搜本机内容。
        label: "搜索",
        icon: Search,
        descriptor: resourceFileTab({ scheme: "tool", kind: "search", id: "default" }, "搜索"),
      },
      {
        // 「AI 网站」= 外部 AI 站点启动器 (ChatGPT/Claude/…), 与文件工作区的内置 AI 对话区分。
        label: "AI 网站",
        icon: Bot,
        descriptor: resourceFileTab({ scheme: "tool", kind: "ai", id: "default" }, "AI 网站"),
      },
      {
        label: "导航",
        icon: Compass,
        descriptor: resourceFileTab({ scheme: "tool", kind: "navigation", id: "default" }, "导航"),
      },
    ],
  },
  {
    // 浏览器 = 外部资源模块 (内嵌 webview); 插件/宿主 UI 的外链均经此打开 (见 browser-open.ts)。
    id: "browser",
    label: "浏览器",
    icon: Globe,
    colorClass: "text-spoke-community",
    sidebarTitle: "浏览器",
    entries: [
      {
        label: "浏览器",
        icon: Globe,
        descriptor: resourceFileTab({ scheme: "browser", kind: "page", id: "default" }, "浏览器"),
      },
    ],
  },
  // 注: "agent" 刻意不在 MODULES 内, 由顶栏 AI 侧栏入口 + ai-* 区段标签
  //     (ai-settings/ai-mcp/ai-skills/ai-rules/ai-tasks, 见 registry) 出现, 外加右侧常驻对话栏 (right-ai-panel.tsx)。
]

export function moduleById(id: ModuleId): ModuleConfig {
  return MODULES.find((m) => m.id === id) ?? MODULES[0]
}

const ALL_ENTRIES = MODULES.flatMap((m) => m.entries)

/** 由路由路径解析出标签描述符 (供路由标记 OpenWorkspaceTab 用)。 */
export function descriptorForPath(pathname: string): TabDescriptor | null {
  if (!pathname || pathname === "/") return homeEntries[0].descriptor
  // 精确匹配
  const exact = ALL_ENTRIES.find((entry) => entry.descriptor.path?.split("?", 1)[0] === pathname)
  if (exact) return exact.descriptor
  // /home/agent 是「打开右侧 AI 栏」的虚拟命令路由, 不对应任何标签 → 显式 null。
  if (pathname.startsWith("/home/agent")) return null
  // 前缀回退仅解析旧 URL；新入口直接使用上方规范 file/path descriptor。
  if (pathname.startsWith("/home/subscriptions")) return tabDescriptor("subscriptions")
  if (pathname.startsWith("/home/settings")) return tabDescriptor("home-settings")
  if (pathname.startsWith("/home")) return homeEntries[0].descriptor
  if (pathname.startsWith("/info")) return tabDescriptor("info")
  if (pathname.startsWith("/community")) return tabDescriptor("community")
  if (pathname.startsWith("/browser")) {
    return resourceFileTab({ scheme: "browser", kind: "page", id: "default" }, "浏览器")
  }
  if (pathname.startsWith("/apps")) return tabDescriptor("apps")
  if (pathname.startsWith("/shell")) return tabDescriptor("shell")
  for (const id of ["git", "database", "audio"] as const) {
    if (pathname.startsWith(`/${id}`)) {
      return PLUGIN_ENTRIES.find((entry) => entry.id === id)?.descriptor ?? null
    }
  }
  if (pathname.startsWith("/code")) return tabDescriptor("code")
  if (pathname.startsWith("/trash")) return tabDescriptor("trash")
  if (pathname.startsWith("/tool")) return tabDescriptor("tool-search")
  return null
}

/**
 * 由 ?resource=node:kind:id 或旧 ?node=kind:id 查询串解析出节点标签描述符。
 * 无资源参数或非法 → null (调用侧回退 descriptorForPath)。与 descriptorForPath 分离
 * (后者只收 pathname): 节点标签共享 /home/notes 壳, 仅 query 区分。
 */
export function descriptorForResource(search: string): TabDescriptor | null {
  // title 占位为 id, viewer 取数后经 renameNodeTab 修正 (不入 tabKey, 不影响去重)。
  return descriptorForResourceSearch(search)
}
