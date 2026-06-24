// Places (根命名空间) —— 一切皆文件: 「我的」下的本地数据按 kind 归并为可切换的根命名空间。
// 活动栏 home 子项的重释 (§5.4): 选一个 place → 侧栏展示该命名空间的跨 kind 文件树。
import type { ComponentType } from "react"
import { Bookmark, Bot, FolderOpen, NotebookPen, Rss } from "lucide-react"
import type { NodeKind } from "@protocol/node"
import type { TabDescriptor } from "./types"

export type PlaceId = "notes" | "bookmarks" | "resources" | "feeds" | "threads"

export type Place = {
  id: PlaceId
  label: string
  icon: ComponentType<{ className?: string }>
  /** 该命名空间收纳的 node kind (驱动跨 kind 文件树读取)。 */
  kinds: NodeKind[]
  /** 该命名空间对应的模块管理器 (place 底部「打开管理器」, 及无查看器 kind 的兜底落点); 对话无独立管理器 (右侧 AI 栏)。 */
  manager?: TabDescriptor
  /** 空树提示。 */
  emptyHint: string
}

export const PLACES: Place[] = [
  {
    id: "notes",
    label: "笔记",
    icon: NotebookPen,
    kinds: ["note"],
    manager: { kind: "home-notes", module: "home", title: "笔记", path: "/home/notes" },
    emptyHint: "还没有笔记。在「笔记」管理器里新建。",
  },
  {
    id: "bookmarks",
    label: "书签",
    icon: Bookmark,
    kinds: ["folder", "bookmark"],
    manager: { kind: "home-bookmarks", module: "home", title: "书签", path: "/home/bookmarks" },
    emptyHint: "还没有书签。在「书签」管理器里添加。",
  },
  {
    id: "resources",
    label: "资源",
    icon: FolderOpen,
    kinds: ["file"],
    manager: { kind: "home-resources", module: "home", title: "资源", path: "/home/resources" },
    emptyHint: "还没有文件。在「资源」管理器里上传。",
  },
  {
    id: "feeds",
    label: "订阅",
    icon: Rss,
    kinds: ["feed"],
    manager: {
      kind: "subscriptions",
      module: "subscriptions",
      title: "订阅",
      path: "/home/subscriptions",
    },
    emptyHint: "还没有订阅。去「发现」订阅，内容会回流到这里。",
  },
  {
    id: "threads",
    label: "对话",
    icon: Bot,
    kinds: ["thread"],
    // 对话无独立管理器标签 (交互在右侧 AI 栏); 点会话节点直接开只读会话标签。
    emptyHint: "还没有对话。在右侧 AI 栏开始。",
  },
]

export function placeById(id: PlaceId): Place {
  return PLACES.find((p) => p.id === id) ?? PLACES[0]
}
