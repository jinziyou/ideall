import { Bot } from "lucide-react"
import type { ComponentType } from "react"
import {
  NAVIGATION_SECTIONS as FILE_SYSTEM_NAVIGATION_SECTIONS,
  type NavigationSectionId,
} from "@/filesystem/navigation-file-system"
import { joinIdeallPath } from "@/filesystem/path"
import { panelFileRef } from "@/filesystem/resource-file-system"
import type { OpenTarget } from "@/workspace/open-target"
import { MODULE_META } from "@/workspace/module-meta"

type PathTarget = Extract<OpenTarget, { type: "path" }>
type FileTarget = Extract<OpenTarget, { type: "file" }>
type CommandTarget = Extract<OpenTarget, { type: "command" }>

export type ShellNavigationTarget = PathTarget | FileTarget | CommandTarget

/**
 * Shell 只消费 navigation FileSystem 的 section/item 身份；路径由目录定义拼出，避免再维护
 * 一张 href 路由表。Next URL 仅留给深链与认证/错误等浏览器边界。
 */
function navigationTarget(sectionId: NavigationSectionId, itemId?: string): PathTarget {
  const section = FILE_SYSTEM_NAVIGATION_SECTIONS.find((candidate) => candidate.id === sectionId)
  if (!section) throw new Error(`Unknown navigation section: ${sectionId}`)
  const sectionPath = joinIdeallPath("/", section.pathName)
  if (!itemId) {
    return { type: "path", path: sectionPath, rootId: section.id, transient: true }
  }
  const item = section.items.find((candidate) => candidate.id === itemId)
  if (!item) throw new Error(`Unknown navigation item: ${sectionId}/${itemId}`)
  return {
    type: "path",
    path: joinIdeallPath(sectionPath, item.pathName),
    rootId: section.id,
    transient: true,
  }
}

/** 工作区导航项；target 是运行态身份，shortcut 只负责展示。 */
export type NavLink = {
  id: string
  target: ShellNavigationTarget
  shortcut?: string
  label: string
  icon: ComponentType<{ className?: string }>
  /** 发现模块分类色 (Tailwind bg-spoke-* 类), 仅用于小圆点 */
  dot?: string
  /** 我的内分组 — home=本机数据区, system=系统能力/插件 (缺省即 home) */
  group?: "home" | "system"
  /** 一句话能力提示, 供「我的」的「去发现」卡使用 */
  hint?: string
}

function pathLink(
  id: string,
  target: PathTarget,
  presentation: Omit<NavLink, "id" | "target" | "shortcut">,
): NavLink {
  return { id, target, shortcut: target.path, ...presentation }
}

export const HOME_TARGET = navigationTarget("home")
export const FOLLOWING_TARGET = navigationTarget("home", "following")
export const BOOKMARKS_TARGET = navigationTarget("home", "bookmarks")
export const RESOURCES_TARGET = navigationTarget("home", "resources")
export const FILES_TARGET = navigationTarget("home", "files")
export const NEWS_TARGET = navigationTarget("browse", "news")
export const COMMUNITY_TARGET = navigationTarget("browse", "community")
export const BROWSER_TARGET = navigationTarget("browse", "browser")
export const SEARCH_TARGET = navigationTarget("apps", "search")
export const INSTALLED_APPS_TARGET = navigationTarget("apps", "local-apps")
export const TRASH_TARGET = navigationTarget("activity", "deleted")

// 这些能力尚未挂入 navigation FileSystem；先直接打开其 FileRef，不再绕 Next URL。
export const OVERVIEW_TARGET: FileTarget = {
  type: "file",
  ref: panelFileRef("home"),
  rootId: "home",
  transient: true,
}
export const PUBLICATIONS_TARGET: FileTarget = {
  type: "file",
  ref: panelFileRef("publications"),
  rootId: "browse",
  transient: true,
}
export const CODE_TARGET: FileTarget = {
  type: "file",
  ref: panelFileRef("code"),
  rootId: "apps",
  transient: true,
}
export const AGENT_TARGET: CommandTarget = { type: "command", command: "open-ai-panel" }

export const HOME_LABEL = "我的"

/** 三个发现模块: 内容经关注汇入「我的」, 各带一个分类色点。label/icon/分类色见 MODULE_META。 */
export const SPOKES: NavLink[] = [
  pathLink("info", NEWS_TARGET, {
    label: MODULE_META.info.label,
    icon: MODULE_META.info.icon,
    dot: MODULE_META.info.dotClass,
    hint: "关注发布者与实体 · 文章加书签",
  }),
  pathLink("community", COMMUNITY_TARGET, {
    label: MODULE_META.community.label,
    icon: MODULE_META.community.icon,
    dot: MODULE_META.community.dotClass,
    hint: "关注社区发布者 · 接收他人发布",
  }),
  {
    id: "publications",
    target: PUBLICATIONS_TARGET,
    label: MODULE_META.publications.label,
    icon: MODULE_META.publications.icon,
    dot: MODULE_META.publications.dotClass,
    hint: "用账号身份发布公开内容",
  },
  pathLink("tool", SEARCH_TARGET, {
    label: MODULE_META.tool.label,
    icon: MODULE_META.tool.icon,
    dot: MODULE_META.tool.dotClass,
    hint: "固定工具 · 把搜索存成关注",
  }),
]

/** 「我的」概览能力及四个真实子目录，供命令面板打开。 */
export const HOME_SUBPAGES: NavLink[] = [
  {
    id: "overview",
    target: OVERVIEW_TARGET,
    label: MODULE_META.overview.label,
    icon: MODULE_META.overview.icon,
  },
  pathLink("files", FILES_TARGET, {
    label: MODULE_META.notes.label,
    icon: MODULE_META.notes.icon,
    hint: "浏览与编写本机文件页",
  }),
  pathLink("following", FOLLOWING_TARGET, {
    label: MODULE_META.subscriptions.label,
    icon: MODULE_META.subscriptions.icon,
  }),
  pathLink("resources", RESOURCES_TARGET, {
    label: MODULE_META.resources.label,
    icon: MODULE_META.resources.icon,
  }),
  pathLink("bookmarks", BOOKMARKS_TARGET, {
    label: MODULE_META.bookmarks.label,
    icon: MODULE_META.bookmarks.icon,
  }),
]

/** 非目录能力也通过 OpenTarget 分发，不借用伪路由。 */
export const SYSTEM_TARGETS: NavLink[] = [
  {
    id: "agent",
    target: AGENT_TARGET,
    label: "AI 智能体",
    icon: Bot,
    group: "system",
  },
]
