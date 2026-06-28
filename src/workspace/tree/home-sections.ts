// 「我的」(home) 的区段单一真相源: 二级侧栏的 4 个常驻区段 + 概览首页描述符。
// 全部归属 module:"home" —— 点击在主区开/激活对应标签, 活动栏「我的」保持高亮, 侧栏不切走。
// 概览由活动栏「我的」钮直达, 不在侧栏列; 侧栏以文件树展示各区段及其 node 子项 (见 sidebar-tree)。

import type { ComponentType } from "react"
import { Bookmark, FolderOpen, Megaphone, NotebookPen, Rss } from "lucide-react"
import type { TabDescriptor } from "../types"

export type HomeSection = {
  id: string
  label: string
  icon: ComponentType<{ className?: string }>
  descriptor: TabDescriptor
}

/** 「我的」首页 = 概览 (点活动栏「我的」直达)。 */
export const HOME_OVERVIEW: TabDescriptor = {
  kind: "home-overview",
  module: "home",
  title: "概览",
  path: "/home",
}

/** 二级侧栏区段 (上→下): 关注 · 收藏 · 资源 · 发布 · 笔记。
 *  「资源」是「我的」五类本机数据之一 (笔记/书签/资源/关注/对话), 此前漏列 → 桌面侧栏/概览无入口, 现补回。 */
export const HOME_SECTIONS: HomeSection[] = [
  {
    // 关注 = 订阅流, 归到「我的」(module:home); params 让它成为独立标签实例,
    // 与活动栏「关注」模块的标签(kind:subscriptions, 无 params)分开, 互不抢 mode。
    // 不设 path: 不参与 URL 同步 —— 否则 /home/subscriptions 会回解析成「关注」模块而翻 mode。
    id: "subscriptions",
    label: "关注",
    icon: Rss,
    descriptor: { kind: "subscriptions", module: "home", title: "关注", params: { in: "home" } },
  },
  {
    id: "bookmarks",
    label: "收藏",
    icon: Bookmark,
    descriptor: { kind: "home-bookmarks", module: "home", title: "收藏", path: "/home/bookmarks" },
  },
  {
    id: "resources",
    label: "资源",
    icon: FolderOpen,
    descriptor: { kind: "home-resources", module: "home", title: "资源", path: "/home/resources" },
  },
  {
    id: "publications",
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
    id: "notes",
    label: "笔记",
    icon: NotebookPen,
    descriptor: { kind: "home-notes", module: "home", title: "笔记", path: "/home/notes" },
  },
]
