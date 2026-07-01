// 模块身份唯一数据来源 —— label + icon (+ 分区色) 的唯一出处。
// 外壳导航 (shell/nav-config: 桌面头部 / 移动 Sheet / ⌘K 命令面板) 与工作区模块 (workspace/modules: 活动栏 / 二级侧栏 / 路由解析)
// 都从此派生各自渲染结构 —— 改一个模块的名字 / 图标 / 分类色只改这里, 两侧自动一致 (杜绝手抄漂移)。
// 注: 分区色存「字面量类名」(dot=小圆点 bg-spoke-*; tint=图标着色 text-spoke-*) ——
//     Tailwind v4 按源码字面量扫描生成工具类, 不可用模板拼接 (拼接会被当成未用而不生成 → 掉色)。
import {
  Bookmark,
  FolderOpen,
  LayoutDashboard,
  LayoutGrid,
  Map,
  Megaphone,
  Newspaper,
  NotebookPen,
  Rss,
  Wrench,
} from "lucide-react"
import type { ComponentType } from "react"

type Icon = ComponentType<{ className?: string }>

export type ModuleMeta = {
  label: string
  icon: Icon
  /** 小圆点分类色 (导航分区点)。Tailwind 字面量。 */
  dotClass?: string
  /** 图标着色分类色 (工作区活动栏)。Tailwind 字面量。 */
  tintClass?: string
}

/** 在「外壳导航」与「工作区模块」两处都出现、需保持一致的模块身份原子。 */
export const MODULE_META = {
  overview: { label: "概览", icon: LayoutDashboard },
  notes: { label: "笔记", icon: NotebookPen },
  subscriptions: { label: "关注", icon: Rss, tintClass: "text-spoke-info" },
  publications: { label: "发布", icon: Megaphone },
  resources: { label: "资源", icon: FolderOpen },
  bookmarks: { label: "书签", icon: Bookmark },
  info: { label: "资讯", icon: Newspaper, dotClass: "bg-spoke-info", tintClass: "text-spoke-info" },
  community: {
    label: "社区",
    icon: Map,
    dotClass: "bg-spoke-community",
    tintClass: "text-spoke-community",
  },
  tool: { label: "工具", icon: Wrench, dotClass: "bg-spoke-tool", tintClass: "text-spoke-tool" },
  apps: { label: "应用", icon: LayoutGrid, tintClass: "text-spoke-tool" },
} satisfies Record<string, ModuleMeta>
