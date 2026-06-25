// 工作区模块配置 (单一真相源): 驱动活动栏 + 二级侧栏 + 路由→标签解析。
// 两种模式 (模式切换):
//   本地(local): 我的(home) · 关注(subscriptions) · 关注(following) —— 只存本机的个人数据
//   连接(connected): 资讯(info) · 社区(community) · 工具(tool) · AI(agent) —— 联网的发现/工具/AI

import type { ComponentType } from "react"
import {
  Bookmark,
  Bot,
  Compass,
  FolderOpen,
  Hexagon,
  LayoutDashboard,
  Map as MapIcon,
  Megaphone,
  Newspaper,
  NotebookPen,
  Rss,
  Search,
  Wrench,
} from "lucide-react"
import type { ModuleId, TabDescriptor, WsMode } from "./types"
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
    label: "概览",
    icon: LayoutDashboard,
    descriptor: { kind: "home-overview", module: "home", title: "概览", path: "/home" },
  },
  {
    label: "笔记",
    icon: NotebookPen,
    descriptor: { kind: "home-notes", module: "home", title: "笔记", path: "/home/notes" },
  },
  {
    label: "发布",
    icon: Megaphone,
    descriptor: {
      kind: "home-publications",
      module: "home",
      title: "发布",
      path: "/home/publications",
    },
  },
  {
    label: "资源",
    icon: FolderOpen,
    descriptor: { kind: "home-resources", module: "home", title: "资源", path: "/home/resources" },
  },
  {
    label: "书签",
    icon: Bookmark,
    descriptor: { kind: "home-bookmarks", module: "home", title: "书签", path: "/home/bookmarks" },
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
    label: "关注",
    icon: Rss,
    colorClass: "text-spoke-info",
    sidebarTitle: "关注",
    sidebarHint: "关注的发布者 / 实体 / 搜索 / 社区发布者，内容汇入「我的」。",
    entries: [
      {
        label: "关注流",
        icon: Rss,
        descriptor: {
          kind: "subscriptions",
          module: "subscriptions",
          title: "关注",
          path: "/home/subscriptions",
        },
      },
    ],
  },
  // —— 连接 ——
  {
    id: "info",
    mode: "connected",
    label: "资讯",
    icon: Newspaper,
    colorClass: "text-spoke-info",
    sidebarTitle: "资讯",
    sidebarHint: "聚合发布者与实体资讯，关注与收藏汇入「我的」。",
    entries: [
      {
        label: "资讯主页",
        icon: Newspaper,
        descriptor: { kind: "info", module: "info", title: "资讯", path: "/info" },
        hint: "聚合资讯（嵌入应用）",
      },
    ],
  },
  {
    id: "community",
    mode: "connected",
    label: "社区",
    icon: MapIcon,
    colorClass: "text-spoke-community",
    sidebarTitle: "社区",
    sidebarHint: "发现社区发布者并关注，他们的发布汇入「我的」。",
    entries: [
      {
        label: "社区主页",
        icon: MapIcon,
        descriptor: { kind: "community", module: "community", title: "社区", path: "/community" },
        hint: "社区发布（嵌入应用）",
      },
    ],
  },
  {
    id: "tool",
    mode: "connected",
    label: "工具",
    icon: Wrench,
    colorClass: "text-spoke-tool",
    sidebarTitle: "工具",
    sidebarHint: "搜索 / AI / 导航，钉住的工具汇入「我的」。",
    entries: [
      {
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
  if (pathname.startsWith("/home")) return homeEntries[0].descriptor
  if (pathname.startsWith("/info"))
    return { kind: "info", module: "info", title: "资讯", path: "/info" }
  if (pathname.startsWith("/community"))
    return { kind: "community", module: "community", title: "社区", path: "/community" }
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
