import type { ComponentType } from "react"
import { Boxes, MessagesSquare } from "lucide-react"
import type { NodeKind } from "@protocol/node"
import { MODULE_META } from "../module-meta"
import { tabDescriptor } from "../tab-definitions"
import type { TabDescriptor } from "../types"

export type HomePlaceId = "subscriptions" | "bookmarks" | "resources" | "notes" | "workspace"

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
  /** 区段头点击打开的面板标签; 缺省 = 纯容器, 点击仅展开/折叠子树。 */
  descriptor?: TabDescriptor
  /** 区段展开后懒加载的本地节点 kind。 */
  childKinds: NodeKind[]
  /** 区段下的静态子容器, 例如「工作区 / 对话」。 */
  staticChildren?: HomePlaceStaticChild[]
}

/** 「我的」places 单源: 侧栏、概览卡片与移动面包屑都从这里派生。 */
export const HOME_PLACES: HomePlace[] = [
  {
    // 关注 = 订阅流, 归到「我的」(module:home); params 让它成为独立标签实例,
    // 与活动栏「关注」模块的标签(kind:subscriptions, 无 params)分开。
    id: "subscriptions",
    label: MODULE_META.subscriptions.label,
    icon: MODULE_META.subscriptions.icon,
    descriptor: tabDescriptor("subscriptions", {
      module: "home",
      title: MODULE_META.subscriptions.label,
      params: { in: "home" },
      path: undefined,
    }),
    childKinds: ["feed"],
  },
  {
    id: "bookmarks",
    label: MODULE_META.bookmarks.label,
    icon: MODULE_META.bookmarks.icon,
    descriptor: tabDescriptor("home-bookmarks"),
    childKinds: ["folder", "bookmark"],
  },
  {
    id: "resources",
    label: MODULE_META.resources.label,
    icon: MODULE_META.resources.icon,
    descriptor: tabDescriptor("home-resources"),
    childKinds: ["file"],
  },
  {
    id: "notes",
    label: MODULE_META.notes.label,
    icon: MODULE_META.notes.icon,
    descriptor: tabDescriptor("home-notes"),
    childKinds: ["note"],
  },
  {
    id: "workspace",
    label: "工作区",
    icon: Boxes,
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
