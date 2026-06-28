// 工作区模块配置 (桌面工作区壳的单一真相源): 驱动活动栏 + 二级侧栏 + 路由→标签解析。
// 两种模式 (模式切换):
//   本地(local): 我的(home) · 关注(subscriptions) · 应用(apps) · 工具(tool) —— 本机数据 + 常用工具
//   连接(connected): 资讯(info) · 社区(community) —— 嵌入 SPA 插件 (wonita/portal iframe, 客户端路由)
//                    浏览器(browser) —— 外部网页资源 (内嵌 webview, 仅桌面 App)
// 注: 「搜索」= 聚合搜索 (跳外部搜索引擎), 已并入「工具」; 顶栏的「本地搜索」搜本机内容, 两者职责分离。
//
// 导航有意分两源、各管一界面, 不是重复——勿强行合并 (二者经 module-meta 的 MODULE_META 共享身份, 已无手抄漂移):
//   · 本文件 (modules.ts): 桌面 IDE 式工作区 (活动栏/侧栏/标签) + descriptorForPath 路由解析。
//   · shell/nav-config.ts:  移动端 Sheet/底栏 + ⌘K 命令台 (扁平 href 链接范式)。
// 桌面是「模块→标签」、移动是「href→路由」两种范式; 命令台经 router.push→OpenWorkspaceTab 标记桥接到同一标签, 故无需统一。

import type { ComponentType } from "react"
import { Bot, Compass, Globe, Hexagon, Search } from "lucide-react"
import type { ModuleId, TabDescriptor, WsMode } from "./types"
import { MODULE_META } from "./module-meta"
import { nodeTab } from "./node-tab"
import { parseNodeQuery } from "./node-ref"

export type SidebarEntry = {
  label: string
  icon: ComponentType<{ className?: string }>
  descriptor: TabDescriptor
  hint?: string
}

export type ModuleConfig = {
  id: ModuleId
  mode: WsMode
  label: string
  icon: ComponentType<{ className?: string }>
  /** spoke 分类色 (text-*), 仅用于图标着色, 不大面积 fill。 */
  colorClass?: string
  sidebarTitle: string
  sidebarHint?: string
  entries: SidebarEntry[]
}

const homeEntries: SidebarEntry[] = [
  {
    label: MODULE_META.overview.label,
    icon: MODULE_META.overview.icon,
    descriptor: { kind: "home-overview", module: "home", title: "概览", path: "/home" },
  },
  {
    label: MODULE_META.notes.label,
    icon: MODULE_META.notes.icon,
    descriptor: { kind: "home-notes", module: "home", title: "笔记", path: "/home/notes" },
  },
  {
    label: MODULE_META.publications.label,
    icon: MODULE_META.publications.icon,
    descriptor: {
      kind: "home-publications",
      module: "home",
      title: "发布",
      path: "/home/publications",
    },
  },
  {
    label: MODULE_META.resources.label,
    icon: MODULE_META.resources.icon,
    descriptor: { kind: "home-resources", module: "home", title: "资源", path: "/home/resources" },
  },
  {
    // 「我的」语境下书签即「收藏」(标签/区段名统一为收藏; 底层仍是 bookmark 节点)。
    label: "收藏",
    icon: MODULE_META.bookmarks.icon,
    descriptor: { kind: "home-bookmarks", module: "home", title: "收藏", path: "/home/bookmarks" },
  },
]

export const MODULES: ModuleConfig[] = [
  // —— 本地 ——
  {
    id: "home",
    mode: "local",
    label: "我的",
    icon: Hexagon,
    sidebarTitle: "我的",
    sidebarHint: "本地优先的「我的」，笔记 / 书签 / 资源只存本机。",
    entries: homeEntries,
  },
  {
    // 关注 = 全部动态来源 (发布者 / 实体 / 搜索 / 社区发布者 peer) 的统一入口; 内容汇入「我的」。
    // 旧的「关注」(资讯源) 与「关注」(社区 peer) 两个入口已合并到这里。
    id: "subscriptions",
    mode: "local",
    label: MODULE_META.subscriptions.label,
    icon: MODULE_META.subscriptions.icon,
    colorClass: MODULE_META.subscriptions.tintClass,
    sidebarTitle: "关注",
    sidebarHint: "关注的发布者 / 实体 / 搜索 / 社区发布者，内容汇入「我的」。",
    entries: [
      {
        label: "关注流",
        icon: MODULE_META.subscriptions.icon,
        descriptor: {
          kind: "subscriptions",
          module: "subscriptions",
          title: "关注",
          path: "/home/subscriptions",
        },
      },
    ],
  },
  {
    id: "apps",
    mode: "local",
    label: MODULE_META.apps.label,
    icon: MODULE_META.apps.icon,
    colorClass: MODULE_META.apps.tintClass,
    sidebarTitle: "应用",
    sidebarHint: "识别并启动本机已安装的应用 (.desktop / 开始菜单 / Applications)。",
    entries: [
      {
        label: "全部应用",
        icon: MODULE_META.apps.icon,
        descriptor: { kind: "apps", module: "apps", title: "应用", path: "/apps" },
      },
    ],
  },
  {
    id: "tool",
    mode: "local",
    label: MODULE_META.tool.label,
    icon: MODULE_META.tool.icon,
    colorClass: MODULE_META.tool.tintClass,
    sidebarTitle: "工具",
    sidebarHint: "搜索 / AI / 导航，钉住的工具汇入「我的」。",
    entries: [
      {
        // 聚合搜索 (选引擎输词跳转外部搜索引擎); 侧栏顶部还有内联搜索框 (SidebarWebSearch)。
        // 与顶栏「本地搜索」职责分离: 前者跳外部引擎, 后者搜本机内容。
        label: "搜索",
        icon: Search,
        descriptor: { kind: "tool-search", module: "tool", title: "搜索", path: "/tool/search" },
      },
      {
        label: "AI",
        icon: Bot,
        descriptor: { kind: "tool-ai", module: "tool", title: "AI", path: "/tool/ai" },
      },
      {
        label: "导航",
        icon: Compass,
        descriptor: {
          kind: "tool-navigation",
          module: "tool",
          title: "导航",
          path: "/tool/navigation",
        },
      },
    ],
  },
  // —— 连接 ——
  {
    id: "info",
    mode: "connected",
    label: MODULE_META.info.label,
    icon: MODULE_META.info.icon,
    colorClass: MODULE_META.info.tintClass,
    sidebarTitle: "资讯",
    sidebarHint: "侧栏为已关注的实体；点击条目在资讯应用中打开。",
    entries: [
      {
        label: "资讯主页",
        icon: MODULE_META.info.icon,
        descriptor: { kind: "info", module: "info", title: "资讯", path: "/info" },
        hint: "聚合资讯（嵌入应用）",
      },
    ],
  },
  {
    id: "community",
    mode: "connected",
    label: MODULE_META.community.label,
    icon: MODULE_META.community.icon,
    colorClass: MODULE_META.community.tintClass,
    sidebarTitle: "社区",
    sidebarHint: "侧栏为已关注的社区发布者；点击条目查看其发布。",
    entries: [
      {
        label: "社区主页",
        icon: MODULE_META.community.icon,
        descriptor: { kind: "community", module: "community", title: "社区", path: "/community" },
        hint: "社区发布（嵌入应用）",
      },
    ],
  },
  {
    // 浏览器 = 外部资源模块 (内嵌 webview); 插件/宿主 UI 的外链均经此打开 (见 browser-open.ts)。
    id: "browser",
    mode: "connected",
    label: "浏览器",
    icon: Globe,
    colorClass: "text-spoke-community",
    sidebarTitle: "浏览器",
    sidebarHint: "侧栏为收藏夹与书签；点击条目在内嵌浏览器中打开（仅桌面 App）。",
    entries: [
      {
        label: "浏览器",
        icon: Globe,
        descriptor: {
          kind: "browser-view",
          module: "browser",
          title: "浏览器",
          path: "/browser",
        },
      },
    ],
  },
  // 注: AI 不再作为活动栏模块/标签, 改为右侧常驻对话栏 (AI 原生)；见 right-ai-panel.tsx。
]

export function moduleById(id: ModuleId): ModuleConfig {
  return MODULES.find((m) => m.id === id) ?? MODULES[0]
}

/** 某模式下的模块列表 (活动栏按模式渲染)。 */
export function modulesForMode(mode: WsMode): ModuleConfig[] {
  return MODULES.filter((m) => m.mode === mode)
}

const ALL_ENTRIES = MODULES.flatMap((m) => m.entries)

/** 由路由路径解析出标签描述符 (供路由标记 OpenWorkspaceTab 用)。 */
export function descriptorForPath(pathname: string): TabDescriptor | null {
  if (!pathname || pathname === "/") return homeEntries[0].descriptor
  // 精确匹配
  const exact = ALL_ENTRIES.find((e) => e.descriptor.path === pathname)
  if (exact) return exact.descriptor
  // /home/agent 是「打开右侧 AI 栏」的虚拟命令路由, 不对应任何标签 → 显式 null。
  if (pathname.startsWith("/home/agent")) return null
  // 前缀回退
  if (pathname.startsWith("/home/subscriptions"))
    return {
      kind: "subscriptions",
      module: "subscriptions",
      title: "关注",
      path: "/home/subscriptions",
    }
  if (pathname.startsWith("/home/following"))
    // 关注已合并入 subscriptions 模块; /home/following 仍可达, 解析到统一「关注」标签。
    return {
      kind: "subscriptions",
      module: "subscriptions",
      title: "关注",
      path: "/home/subscriptions",
    }
  if (pathname.startsWith("/home/settings"))
    return {
      kind: "home-settings",
      module: "home",
      title: "设置",
      path: "/home/settings",
    }
  if (pathname.startsWith("/home")) return homeEntries[0].descriptor
  if (pathname.startsWith("/info"))
    return { kind: "info", module: "info", title: "资讯", path: "/info" }
  if (pathname.startsWith("/community"))
    return { kind: "community", module: "community", title: "社区", path: "/community" }
  if (pathname.startsWith("/browser"))
    return { kind: "browser-view", module: "browser", title: "浏览器", path: "/browser" }
  if (pathname.startsWith("/apps"))
    return { kind: "apps", module: "apps", title: "应用", path: "/apps" }
  if (pathname.startsWith("/tool"))
    return { kind: "tool-search", module: "tool", title: "搜索", path: "/tool/search" }
  return null
}

/**
 * 由 ?node=kind:id 查询串解析出节点标签描述符; 无 node 参数或非法 → null (调用侧回退 descriptorForPath)。
 * 与 descriptorForPath 分离 (后者只收 pathname): 节点标签共享 /home/notes 壳, 仅 query 区分。
 */
export function descriptorForNode(search: string): TabDescriptor | null {
  const ref = parseNodeQuery(new URLSearchParams(search).get("node"))
  // title 占位为 id, viewer 取数后经 renameNodeTab 修正 (不入 tabKey, 不影响去重)。
  return ref ? nodeTab(ref, ref.id) : null
}
