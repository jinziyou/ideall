// 「我的」(home) 的区段唯一数据来源: 二级侧栏的常驻区段
// (关注·书签·资源·笔记·工作区; 对话挂在工作区下面)。
// 全部归属 module:"home" —— 点击在主区开/激活对应标签, 活动栏「我的」保持高亮, 侧栏不切走。

import type { ComponentType } from "react"
import { Boxes } from "lucide-react"
import { MODULE_META } from "../module-meta"
import type { TabDescriptor } from "../types"

export type HomeSection = {
  id: string
  label: string
  icon: ComponentType<{ className?: string }>
  /** 区段头点击打开的面板标签; 缺省 (如「工作区」容器) = 纯容器, 点击仅展开/折叠子树。 */
  descriptor?: TabDescriptor
}

/** 二级侧栏区段 (上→下): 关注 · 书签 · 资源 · 笔记 · 工作区。
 *  与 README/architecture 的「我的」本机数据口径对齐 (笔记/书签/资源/关注/对话) ——
 *  「对话即文件」(§6.5): thread 挂在工作区下面, 仍与笔记/书签一样可从树寻址。 */
export const HOME_SECTIONS: HomeSection[] = [
  {
    // 关注 = 订阅流, 归到「我的」(module:home); params 让它成为独立标签实例,
    // 与活动栏「关注」模块的标签(kind:subscriptions, 无 params)分开 —— 点它侧栏留在「我的」树, 不切走。
    // 不设 path: 不参与 URL 同步 —— 否则 /home/subscriptions 会回解析成「关注」模块的标签实例, 与本实例互抢激活。
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
  {
    // 工作区: AI 对话与后续工作空间相关本地内容的容器; 对话(thread) 在它下面展开。
    // 概览卡片对它特殊处理 (无 descriptor → 呼出右侧 AI 栏)。
    id: "workspace",
    label: "工作区",
    icon: Boxes,
  },
]
