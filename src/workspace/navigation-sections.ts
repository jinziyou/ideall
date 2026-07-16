import type { ComponentType } from "react"
import type { DirectoryEntry } from "@protocol/file-system"
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
import { joinIdeallPath, type IdeallPath } from "@/filesystem/path"
import {
  NAVIGATION_SECTIONS as FILE_SYSTEM_NAVIGATION_SECTIONS,
  navigationSectionIdForLegacyRoot,
  type NavigationSectionId as FileSystemNavigationSectionId,
} from "@/filesystem/navigation-file-system"

type NavigationIcon = ComponentType<{ className?: string }>

export type NavigationSectionId = FileSystemNavigationSectionId

export type NavigationSection = Readonly<{
  id: NavigationSectionId
  /** FileSystem 尚未完成首次读取时使用的显示回退，不是目录结构或目标的来源。 */
  label: string
  path: IdeallPath
  icon: NavigationIcon
  colorClass?: string
}>

const NAVIGATION_SECTION_PRESENTATION: Readonly<
  Record<NavigationSectionId, { icon: NavigationIcon; colorClass?: string }>
> = {
  home: { icon: Home },
  activity: { icon: History },
  browse: { icon: Compass, colorClass: "text-spoke-community" },
  apps: { icon: AppWindow, colorClass: "text-spoke-tool" },
  settings: { icon: Settings },
}

/**
 * Display 只保留五个稳定分区的图标/颜色装饰。名称、顺序、目录项和 link target
 * 均来自 ideall.root 与 navigation FileSystem，不能在这里再维护第二份信息架构。
 */
export const NAVIGATION_SECTIONS: readonly NavigationSection[] = [
  ...FILE_SYSTEM_NAVIGATION_SECTIONS.map((section) => ({
    id: section.id,
    label: section.name,
    path: joinIdeallPath("/", section.pathName),
    ...NAVIGATION_SECTION_PRESENTATION[section.id],
  })),
]

const NAVIGATION_ICONS: Readonly<Record<string, NavigationIcon>> = {
  home: Home,
  history: History,
  compass: Compass,
  "app-window": AppWindow,
  settings: Settings,
  rss: Rss,
  bookmark: Bookmark,
  "folder-open": FolderOpen,
  "file-text": FileText,
  boxes: Boxes,
  sparkles: Sparkles,
  trash: Trash2,
  "trash-2": Trash2,
  newspaper: Newspaper,
  users: Users,
  search: Search,
  sliders: SlidersHorizontal,
  "sliders-horizontal": SlidersHorizontal,
  bot: Bot,
}

export function navigationIconForHint(
  hint: unknown,
  fallback: NavigationIcon = FileText,
): NavigationIcon {
  return typeof hint === "string" ? (NAVIGATION_ICONS[hint] ?? fallback) : fallback
}

/** 把根目录 link 与纯 Display 装饰合成可见分区；目标与名称始终取自目录项。 */
export function navigationSectionForEntry(entry: DirectoryEntry): NavigationSection | null {
  const id = entry.properties?.navigationSection
  if (typeof id !== "string" || !isNavigationSectionId(id) || !entry.pathName) return null
  const presentation = navigationSection(id)
  return {
    ...presentation,
    label: entry.name,
    path: joinIdeallPath("/", entry.pathName),
    icon: navigationIconForHint(entry.properties?.iconHint, presentation.icon),
  }
}

export function navigationSection(id: string | null | undefined): NavigationSection {
  return NAVIGATION_SECTIONS.find((section) => section.id === id) ?? NAVIGATION_SECTIONS[0]
}

export function isNavigationSectionId(value: string): value is NavigationSectionId {
  return NAVIGATION_SECTIONS.some((section) => section.id === value)
}

/** 旧根目录迁到五分区；动态挂载归“应用”，无效值安全回退“我的”。 */
export function navigationSectionIdForRoot(rootId: string | null | undefined): NavigationSectionId {
  return navigationSectionIdForLegacyRoot(rootId)
}
