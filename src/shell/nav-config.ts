import { Bot } from "lucide-react"
import type { ComponentType } from "react"
import { MODULE_META } from "@/workspace/module-meta"

/** 导航单一真相源 —— 同时驱动桌面头部、移动 Sheet、⌘K 命令台, 杜绝手抄漂移。 */
export type NavLink = {
  href: string
  label: string
  icon: ComponentType<{ className?: string }>
  /** 发现模块分类色 (Tailwind bg-spoke-* 类), 仅用于小圆点 */
  dot?: string
  /** 我的内分组 — home=本机数据区, system=系统能力/插件 (缺省即 home) */
  group?: "home" | "system"
  /** 一句话能力提示, 供「我的」的「去发现」卡使用 */
  hint?: string
}

export const HOME_HREF = "/home"
export const HOME_LABEL = "我的"

/** 三个发现模块: 内容经关注汇入「我的」, 各带一个分类色点。label/icon/分类色见 MODULE_META。 */
export const SPOKES: NavLink[] = [
  {
    href: "/info",
    label: MODULE_META.info.label,
    icon: MODULE_META.info.icon,
    dot: MODULE_META.info.dotClass,
    hint: "关注发布者与实体 · 收藏文章",
  },
  {
    href: "/community",
    label: MODULE_META.community.label,
    icon: MODULE_META.community.icon,
    dot: MODULE_META.community.dotClass,
    hint: "关注社区发布者 · 接收他人发布",
  },
  {
    href: "/tool",
    label: MODULE_META.tool.label,
    icon: MODULE_META.tool.icon,
    dot: MODULE_META.tool.dotClass,
    hint: "钉住工具 · 把搜索存成关注",
  },
]

/** 我的子区 (「我的」内部分区), 供命令台 / 移动菜单跳转。label/icon 见 MODULE_META。 */
export const HOME_SUBPAGES: NavLink[] = [
  { href: "/home", label: MODULE_META.overview.label, icon: MODULE_META.overview.icon },
  {
    href: "/home/notes",
    label: MODULE_META.notes.label,
    icon: MODULE_META.notes.icon,
    hint: "创建与编写笔记",
  },
  {
    href: "/home/subscriptions",
    label: MODULE_META.subscriptions.label,
    icon: MODULE_META.subscriptions.icon,
  },
  {
    href: "/home/publications",
    label: MODULE_META.publications.label,
    icon: MODULE_META.publications.icon,
  },
  { href: "/home/resources", label: MODULE_META.resources.label, icon: MODULE_META.resources.icon },
  { href: "/home/bookmarks", label: MODULE_META.bookmarks.label, icon: MODULE_META.bookmarks.icon },
  { href: "/home/agent", label: "AI 助手", icon: Bot, group: "system" },
]
