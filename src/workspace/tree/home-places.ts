import type { ComponentType } from "react"
import { Inbox, MessagesSquare } from "lucide-react"
import type { NodeKind } from "@protocol/node"
import type { IdeallPath } from "@/filesystem/path"
import { directorySurface } from "../directory-surfaces"
import { MODULE_META } from "../module-meta"

export type HomePlaceId =
  "inbox" | "subscriptions" | "bookmarks" | "resources" | "notes" | "workspace"

export type HomePlaceStaticChild = {
  id: string
  label: string
  icon: ComponentType<{ className?: string }>
  childKinds: NodeKind[]
}

export type HomePlace = {
  id: HomePlaceId
  label: string
  icon: ComponentType<{ className?: string }>
  /** 区段头点击解析的规范文件系统路径；缺省 = 纯容器。 */
  defaultPath?: IdeallPath
  /** 区段展开后懒加载的本地节点 kind。 */
  childKinds: NodeKind[]
  /** 区段下的静态子容器, 例如「工作区 / 对话」。 */
  staticChildren?: HomePlaceStaticChild[]
}

/** 「我的」places 单源: 侧栏、概览卡片与移动面包屑都从这里派生。 */
export const HOME_PLACES: HomePlace[] = [
  {
    id: "inbox",
    label: "收件箱",
    icon: Inbox,
    defaultPath: "/home/inbox",
    childKinds: [],
  },
  {
    id: "subscriptions",
    label: MODULE_META.subscriptions.label,
    icon: MODULE_META.subscriptions.icon,
    defaultPath: directorySurface("subscriptions").navigationPath,
    childKinds: ["feed"],
  },
  {
    id: "bookmarks",
    label: MODULE_META.bookmarks.label,
    icon: MODULE_META.bookmarks.icon,
    defaultPath: directorySurface("bookmarks").navigationPath,
    childKinds: ["folder", "bookmark"],
  },
  {
    id: "resources",
    label: MODULE_META.resources.label,
    icon: MODULE_META.resources.icon,
    defaultPath: directorySurface("resources").navigationPath,
    childKinds: ["file"],
  },
  {
    id: "notes",
    label: MODULE_META.notes.label,
    icon: MODULE_META.notes.icon,
    // 与侧栏「文件」一致: 打开 notes place 目录 (页树), 而非独立笔记面板。
    defaultPath: "/home/files",
    childKinds: ["note"],
  },
  {
    id: "workspace",
    label: "AI 对话",
    icon: MessagesSquare,
    childKinds: [],
    staticChildren: [
      {
        id: "threads",
        label: "对话",
        icon: MessagesSquare,
        childKinds: ["thread"],
      },
    ],
  },
]

export function homePlaceById(id: string): HomePlace | undefined {
  return HOME_PLACES.find((place) => place.id === id)
}

export function homePlaceForNodeKind(kind: NodeKind): HomePlace | undefined {
  return HOME_PLACES.find(
    (place) =>
      place.childKinds.includes(kind) ||
      place.staticChildren?.some((child) => child.childKinds.includes(kind)),
  )
}
