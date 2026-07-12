import type { ComponentType } from "react"
import {
  AppWindow,
  Bookmark,
  Bot,
  Boxes,
  Compass,
  FileText,
  FolderOpen,
  History,
  Home,
  Newspaper,
  Rss,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react"
import type { FileRef } from "@protocol/file-system"
import type { ResourceRef } from "@protocol/resource"
import { corePlaceRef, panelFileRef, resourceFileRef } from "@/filesystem/resource-file-system"

type NavigationIcon = ComponentType<{ className?: string }>

export type NavigationSectionId = "home" | "activity" | "browse" | "apps" | "settings"

export type NavigationItem = Readonly<{
  id: string
  label: string
  icon: NavigationIcon
  target: Readonly<{
    ref: FileRef
    engineId?: string
    kind?: "file" | "directory"
  }>
}>

export type NavigationSection = Readonly<{
  id: NavigationSectionId
  label: string
  icon: NavigationIcon
  colorClass?: string
  items: readonly NavigationItem[]
}>

const panel = (id: string, engineId = "ideall.panel") => ({
  ref: panelFileRef(id),
  engineId,
})

const resource = (ref: ResourceRef, engineId = "ideall.connected") => ({
  ref: resourceFileRef(ref),
  engineId,
})

/**
 * 产品导航的唯一信息架构。一级分区始终同时可见，不再按数据来源切换镜头；
 * 叶项只保存稳定 FileRef，打开后的标签身份仍由 File + Engine 决定。
 */
export const NAVIGATION_SECTIONS: readonly NavigationSection[] = [
  {
    id: "home",
    label: "我的",
    icon: Home,
    items: [
      { id: "following", label: "关注", icon: Rss, target: panel("subscriptions") },
      { id: "bookmarks", label: "书签", icon: Bookmark, target: panel("bookmarks") },
      { id: "resources", label: "资源", icon: FolderOpen, target: panel("files") },
      {
        id: "files",
        label: "文件",
        icon: FileText,
        target: {
          ref: corePlaceRef("notes"),
          engineId: "ideall.directory",
          kind: "directory",
        },
      },
    ],
  },
  {
    id: "activity",
    label: "活动",
    icon: History,
    items: [
      { id: "spaces", label: "空间", icon: Boxes, target: panel("spaces") },
      { id: "tasks", label: "任务", icon: Sparkles, target: panel("tasks") },
      { id: "deleted", label: "删除", icon: Trash2, target: panel("trash") },
    ],
  },
  {
    id: "browse",
    label: "浏览",
    icon: Compass,
    colorClass: "text-spoke-community",
    items: [
      {
        id: "news",
        label: "新闻",
        icon: Newspaper,
        target: resource({ scheme: "info", kind: "home", id: "default" }),
      },
      {
        id: "community",
        label: "社区",
        icon: Users,
        target: resource({ scheme: "community", kind: "home", id: "default" }),
      },
      {
        id: "browser",
        label: "浏览器",
        icon: Compass,
        target: resource({ scheme: "browser", kind: "page", id: "default" }, "ideall.browser"),
      },
    ],
  },
  {
    id: "apps",
    label: "应用",
    icon: AppWindow,
    colorClass: "text-spoke-tool",
    items: [
      {
        id: "search",
        label: "搜索",
        icon: Search,
        target: resource({ scheme: "tool", kind: "search", id: "default" }),
      },
      { id: "local-apps", label: "本地应用", icon: AppWindow, target: panel("apps") },
    ],
  },
  {
    id: "settings",
    label: "设置",
    icon: Settings,
    items: [
      { id: "basic", label: "基本", icon: SlidersHorizontal, target: panel("settings") },
      {
        id: "ai",
        label: "AI",
        icon: Bot,
        target: panel("ai-settings", "ideall.panel-fill"),
      },
    ],
  },
] as const

export function navigationSection(id: string | null | undefined): NavigationSection {
  return NAVIGATION_SECTIONS.find((section) => section.id === id) ?? NAVIGATION_SECTIONS[0]
}

export function isNavigationSectionId(value: string): value is NavigationSectionId {
  return NAVIGATION_SECTIONS.some((section) => section.id === value)
}

/** 旧根目录迁到五分区；动态挂载归“应用”，无效值安全回退“我的”。 */
export function navigationSectionIdForRoot(rootId: string | null | undefined): NavigationSectionId {
  if (!rootId) return "home"
  if (isNavigationSectionId(rootId)) return rootId
  if (["subscriptions", "bookmarks", "files", "notes"].includes(rootId)) return "home"
  if (rootId === "workspace") return "activity"
  if (["info", "community", "browser"].includes(rootId)) return "browse"
  if (rootId === "tool") return "apps"
  if (rootId === "system") return "settings"
  return rootId.startsWith("mount:") ? "apps" : "home"
}
