import {
  Bookmark,
  Bot,
  FolderOpen,
  LayoutDashboard,
  Map,
  Megaphone,
  Newspaper,
  Rss,
  Wrench,
} from "lucide-react"
import type { ComponentType } from "react"

/** 导航单一真相源 —— 同时驱动桌面头部、移动 Sheet、⌘K 命令台, 杜绝手抄漂移。 */
export type NavLink = {
  href: string
  label: string
  icon: ComponentType<{ className?: string }>
  /** spoke 分类色 (Tailwind bg-* 类), 仅用于小圆点 */
  dot?: string
  /** 我的内分组 — hub=中枢数据区, system=系统能力/插件 (缺省即 hub) */
  group?: "hub" | "system"
  /** 一句话能力提示, 供中枢「去发现」卡使用 */
  hint?: string
}

export const HUB_HREF = "/home"
export const HUB_LABEL = "我的"

/** 三条 spoke (发现): 视觉从属于中枢, 各带一个分类色点。 */
export const SPOKES: NavLink[] = [
  {
    href: "/info",
    label: "资讯",
    icon: Newspaper,
    dot: "bg-spoke-info",
    hint: "订阅发布者 / 实体 · 收藏文章",
  },
  {
    href: "/community",
    label: "社区",
    icon: Map,
    dot: "bg-spoke-community",
    hint: "订阅社区发布者 · 接收他人发布",
  },
  {
    href: "/tool",
    label: "工具",
    icon: Wrench,
    dot: "bg-spoke-tool",
    hint: "钉工具 · 存搜索为订阅",
  },
]

/** 我的子区 (中枢内部分区), 供命令台 / 移动菜单跳转。 */
export const HOME_SUBPAGES: NavLink[] = [
  { href: "/home", label: "概览", icon: LayoutDashboard },
  { href: "/home/subscriptions", label: "订阅", icon: Rss },
  { href: "/home/publications", label: "发布", icon: Megaphone },
  { href: "/home/resources", label: "资源", icon: FolderOpen },
  { href: "/home/bookmarks", label: "书签", icon: Bookmark },
  { href: "/home/agent", label: "AI 助手", icon: Bot, group: "system" },
]
