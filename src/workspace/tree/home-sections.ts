// 「我的」(home) 的区段唯一数据来源: 二级侧栏的 5 个常驻区段 (关注·书签·资源·发布·笔记)。
// 全部归属 module:"home" —— 点击在主区开/激活对应标签, 活动栏「我的」保持高亮, 侧栏不切走。
// 概览由活动栏「我的」钮直达, 不在侧栏列; 侧栏以文件树展示各区段及其 node 子项 (见 sidebar-tree)。

import type { ComponentType } from "react"
import { MODULE_META } from "../module-meta"
import type { TabDescriptor } from "../types"

export type HomeSection = {
  id: string
  label: string
  icon: ComponentType<{ className?: string }>
  descriptor: TabDescriptor
}

/** 二级侧栏区段 (上→下): 关注 · 书签 · 资源 · 发布 · 笔记。
 *  「资源」是「我的」五类本机数据之一 (笔记/书签/资源/关注/对话), 此前漏列 → 桌面侧栏/概览无入口, 现补回。 */
export const HOME_SECTIONS: HomeSection[] = [
  {
    // 关注 = 订阅流, 归到「我的」(module:home); params 让它成为独立标签实例,
    // 与活动栏「关注」模块的标签(kind:subscriptions, 无 params)分开, 互不抢 mode。
    // 不设 path: 不参与 URL 同步 —— 否则 /home/subscriptions 会回解析成「关注」模块而翻 mode。
    id: "subscriptions",
    label: MODULE_META.subscriptions.label,
    icon: MODULE_META.subscriptions.icon,
    descriptor: {
      kind: "subscriptions",
      module: "home",
      title: MODULE_META.subscriptions.label,
      params: { in: "home" },
    },
  },
  {
    id: "bookmarks",
    label: MODULE_META.bookmarks.label,
    icon: MODULE_META.bookmarks.icon,
    descriptor: {
      kind: "home-bookmarks",
      module: "home",
      title: MODULE_META.bookmarks.label,
      path: "/home/bookmarks",
    },
  },
  {
    id: "resources",
    label: MODULE_META.resources.label,
    icon: MODULE_META.resources.icon,
    descriptor: {
      kind: "home-resources",
      module: "home",
      title: MODULE_META.resources.label,
      path: "/home/resources",
    },
  },
  {
    id: "publications",
    label: MODULE_META.publications.label,
    icon: MODULE_META.publications.icon,
    descriptor: {
      kind: "home-publications",
      module: "home",
      title: MODULE_META.publications.label,
      path: "/home/publications",
    },
  },
  {
    id: "notes",
    label: MODULE_META.notes.label,
    icon: MODULE_META.notes.icon,
    descriptor: {
      kind: "home-notes",
      module: "home",
      title: MODULE_META.notes.label,
      path: "/home/notes",
    },
  },
]
