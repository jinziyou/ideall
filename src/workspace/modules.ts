// 工作区模块配置 (桌面工作区壳的唯一数据来源): 驱动活动栏 + 二级侧栏 + 路由→标签解析。
// 活动栏按当前「本地/连接」模式视图过滤展示 (顶栏 ModeSwitch 切换; 见 modulesForMode):
//   本机/我的(local): 我的(home) · 关注(subscriptions) · [轨底] 插件 · 应用 · 回收站
//   连接/发现(connected): 资讯(info) · 社区(community) · 发布(publications) · 工具(tool) · 浏览器(browser)
//   工具(tool): crossMode → 两模式活动栏均展示, 打开不翻 mode (见 store isModeNeutralModule)。
// 注: 「搜索」= 聚合搜索 (跳外部搜索引擎), 已并入「工具」; 顶栏搜索框/⌘K 统一面板搜本机内容, 两者职责分离。
//
// 导航有意分两源、各管一界面, 不是重复——勿强行合并 (二者经 module-meta 的 MODULE_META 共享身份, 已无手抄漂移):
//   · 本文件 (modules.ts): 桌面 IDE 式工作区 (活动栏/侧栏/标签) + descriptorForPath 路由解析。
//   · shell/nav-config.ts:  移动端 Sheet/底栏 + ⌘K 命令面板 (扁平 href 链接范式)。
// 桌面是「模块→标签」、移动是「href→路由」两种范式; 命令面板经 router.push→OpenWorkspaceTab 标记桥接到同一标签, 故无需统一。

import type { ComponentType } from "react"
import { Bot, Compass, Globe, Hexagon, Search } from "lucide-react"
import type { ModuleId, TabDescriptor, WsMode } from "./types"
import { MODULE_META } from "./module-meta"
import { PLUGIN_ENTRIES, isPluginModule } from "./plugin-entries"
import { tabDescriptor } from "./tab-definitions"
import { nodeTab } from "./node-tab"
import { parseNodeQuery } from "./node-ref"

export type SidebarEntry = {
  label: string
  icon: ComponentType<{ className?: string }>
  descriptor: TabDescriptor
}

export type ModuleConfig = {
  id: ModuleId
  /** 所属工作区模式视图 (本机/我的 vs 连接/发现); 活动栏按当前 mode 过滤展示。 */
  mode: WsMode
  /** 跨模式常驻: 本地/连接活动栏均展示, 打开时不翻 mode (见 store isModeNeutralModule)。 */
  crossMode?: boolean
  label: string
  icon: ComponentType<{ className?: string }>
  /** 分区色 (text-*), 仅用于图标着色, 不大面积 fill。 */
  colorClass?: string
  sidebarTitle: string
  entries: SidebarEntry[]
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
    descriptor: tabDescriptor("home-resources"),
  },
  {
    // 「我的」语境下的书签区段 (底层仍是 bookmark 节点)。
    label: MODULE_META.bookmarks.label,
    icon: MODULE_META.bookmarks.icon,
    descriptor: tabDescriptor("home-bookmarks"),
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
    entries: [
      {
        label: "关注流",
        icon: MODULE_META.subscriptions.icon,
        descriptor: tabDescriptor("subscriptions"),
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
    entries: [
      {
        label: "全部应用",
        icon: MODULE_META.apps.icon,
        descriptor: tabDescriptor("apps"),
      },
    ],
  },
  {
    id: "plugins",
    mode: "local",
    label: MODULE_META.plugins.label,
    icon: MODULE_META.plugins.icon,
    colorClass: MODULE_META.plugins.tintClass,
    sidebarTitle: "插件",
    entries: PLUGIN_ENTRIES.map(({ label, icon, descriptor }) => ({ label, icon, descriptor })),
  },
  {
    id: "trash",
    mode: "local",
    label: MODULE_META.trash.label,
    icon: MODULE_META.trash.icon,
    colorClass: MODULE_META.trash.tintClass,
    sidebarTitle: "回收站",
    entries: [
      {
        label: MODULE_META.trash.label,
        icon: MODULE_META.trash.icon,
        descriptor: tabDescriptor("trash"),
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
    entries: [
      {
        label: "资讯主页",
        icon: MODULE_META.info.icon,
        descriptor: tabDescriptor("info"),
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
    entries: [
      {
        label: "社区主页",
        icon: MODULE_META.community.icon,
        descriptor: tabDescriptor("community"),
      },
    ],
  },
  {
    id: "publications",
    mode: "connected",
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
    mode: "connected",
    crossMode: true,
    label: MODULE_META.tool.label,
    icon: MODULE_META.tool.icon,
    colorClass: MODULE_META.tool.tintClass,
    sidebarTitle: "工具",
    entries: [
      {
        // 聚合搜索 (选引擎输词跳转外部搜索引擎); 与顶栏搜索框/⌘K 统一面板职责分离: 前者跳外部引擎, 后者搜本机内容。
        label: "搜索",
        icon: Search,
        descriptor: tabDescriptor("tool-search"),
      },
      {
        // 「AI 网站」= 外部 AI 站点启动器 (ChatGPT/Claude/…), 与内置 AI 对话 (活动栏 Bot 钮) 区分。
        label: "AI 网站",
        icon: Bot,
        descriptor: tabDescriptor("tool-ai"),
      },
      {
        label: "导航",
        icon: Compass,
        descriptor: tabDescriptor("tool-navigation"),
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
    entries: [
      {
        label: "浏览器",
        icon: Globe,
        descriptor: tabDescriptor("browser-view"),
      },
    ],
  },
  // 注: "agent" 刻意不在 MODULES 内, 由顶栏 AI 入口 + ai-* 区段标签
  //     (ai-settings/ai-mcp/ai-skills/ai-rules/ai-tasks, 见 registry) 出现, 外加右侧常驻对话栏 (right-ai-panel.tsx)。
]

export function moduleById(id: ModuleId): ModuleConfig {
  return MODULES.find((m) => m.id === id) ?? MODULES[0]
}

/** 某模式下的模块列表 (活动栏按当前视图渲染; crossMode 模块两种模式均展示)。 */
export function modulesForMode(mode: WsMode): ModuleConfig[] {
  return MODULES.filter((m) => m.mode === mode || m.crossMode)
}

/** 模式镜头默认落点: local → 我的, connected → 资讯。 */
export function primaryModuleForMode(mode: WsMode): ModuleId {
  return mode === "local" ? "home" : "info"
}

/** 模块是否应在当前 mode 的左侧导航/侧栏语境中可见。 */
export function isModuleVisibleInMode(id: ModuleId, mode: WsMode): boolean {
  if (id === "agent") return true
  if (mode === "local" && isPluginModule(id)) return true
  return modulesForMode(mode).some((m) => m.id === id)
}

/**
 * 将 activeModule 收束到当前 mode 可见的左侧导航模块。
 * preferred 来自“想激活的标签模块”; current 是当前侧栏锚点。
 * 标签跨 mode 激活时优先保留 current, 避免左侧栏被另一模式污染。
 */
export function coerceActiveModuleForMode(
  preferred: ModuleId,
  mode: WsMode,
  current?: ModuleId,
): ModuleId {
  if (isModuleVisibleInMode(preferred, mode)) return preferred
  if (current && isModuleVisibleInMode(current, mode)) return current
  return primaryModuleForMode(mode)
}

/** 打开/激活时不翻 mode 的模块 (AI 区段 + 跨模式工具): 保留当前视图, 不由 module 反推。 */
export function isModeNeutralModule(id: ModuleId): boolean {
  if (id === "agent") return true
  return MODULES.find((m) => m.id === id)?.crossMode === true
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
  if (pathname.startsWith("/home/subscriptions")) return tabDescriptor("subscriptions")
  if (pathname.startsWith("/home/settings")) return tabDescriptor("home-settings")
  if (pathname.startsWith("/home")) return homeEntries[0].descriptor
  if (pathname.startsWith("/info")) return tabDescriptor("info")
  if (pathname.startsWith("/community")) return tabDescriptor("community")
  if (pathname.startsWith("/browser")) return tabDescriptor("browser-view")
  if (pathname.startsWith("/apps")) return tabDescriptor("apps")
  if (pathname.startsWith("/shell")) return tabDescriptor("shell")
  if (pathname.startsWith("/git")) return tabDescriptor("git")
  if (pathname.startsWith("/database")) return tabDescriptor("database")
  if (pathname.startsWith("/audio")) return tabDescriptor("audio")
  if (pathname.startsWith("/code")) return tabDescriptor("code")
  if (pathname.startsWith("/trash")) return tabDescriptor("trash")
  if (pathname.startsWith("/tool")) return tabDescriptor("tool-search")
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
