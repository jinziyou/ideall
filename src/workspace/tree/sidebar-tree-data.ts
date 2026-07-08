// 二级侧栏文件树的模块→节点 kind 映射与静态根节点构造。
// 动态子节点 (note/bookmark/feed 等) 由 sidebar-tree.tsx 经 listNodeSummaries 懒加载。

import type { ComponentType } from "react"
import { Bookmark, Boxes, Plug, ScrollText, Sparkles, Tag, Users } from "lucide-react"
import type { NodeKind } from "@protocol/node"
import type { ModuleId } from "../types"
import type { OpenTarget } from "../open-target"
import type { ResourceQuery } from "@/vfs/types"
import { HOME_PLACES, type HomePlaceStaticChild } from "./home-places"
import { moduleById } from "../modules"
import type { SidebarEntry } from "../modules"
import { tabDescriptor } from "../tab-definitions"

export type SidebarTreeNodeKind = "section" | "entry"

export type SidebarTreeNode = {
  id: string
  label: string
  icon: ComponentType<{ className?: string }>
  nodeKind: SidebarTreeNodeKind
  /** 点击行时的统一打开目标；纯容器不设置。 */
  target?: OpenTarget
  /** 展开后懒加载的子节点 kind (仅 section 有效) */
  childKinds?: NodeKind[]
  /** 展开后通过 VFS 加载 ResourceMeta (连接模式侧栏)。 */
  childResourceQuery?: ResourceQuery
  /** 展开后展示的静态子区段 (如「工作区」下面的「对话」)。 */
  staticChildren?: SidebarTreeNode[]
  hasChildren: boolean
}

function staticHomeChildNode(placeId: string, child: HomePlaceStaticChild): SidebarTreeNode {
  return {
    id: `section:${placeId}:${child.id}`,
    label: child.label,
    icon: child.icon,
    nodeKind: "section",
    childKinds: child.childKinds,
    hasChildren: true,
  }
}

function entryNode(e: SidebarEntry): SidebarTreeNode {
  return {
    id: `entry:${e.descriptor.kind}`,
    label: e.label,
    icon: e.icon,
    nodeKind: "entry",
    target: { type: "tab", descriptor: e.descriptor },
    hasChildren: false,
  }
}

/** 按当前活动模块构造侧栏树的静态根 (不含 IndexedDB 子节点)。 */
export function staticTreeRoots(moduleId: ModuleId): SidebarTreeNode[] {
  if (moduleId === "home") {
    return HOME_PLACES.map((place) => {
      const staticChildren = place.staticChildren?.map((child) =>
        staticHomeChildNode(place.id, child),
      )
      return {
        id: `section:${place.id}`,
        label: place.label,
        icon: place.icon,
        nodeKind: "section" as const,
        target: place.descriptor ? { type: "tab", descriptor: place.descriptor } : undefined,
        childKinds: place.childKinds,
        staticChildren,
        hasChildren: place.childKinds.length > 0 || Boolean(staticChildren?.length),
      }
    })
  }

  if (moduleId === "agent") {
    return [
      {
        id: "entry:ai-mcp",
        label: "MCP",
        icon: Plug,
        nodeKind: "entry",
        target: { type: "tab", descriptor: tabDescriptor("ai-mcp") },
        hasChildren: false,
      },
      {
        id: "entry:ai-skills",
        label: "Skills",
        icon: Sparkles,
        nodeKind: "entry",
        target: { type: "tab", descriptor: tabDescriptor("ai-skills") },
        hasChildren: false,
      },
      {
        id: "entry:ai-rules",
        label: "规则",
        icon: ScrollText,
        nodeKind: "entry",
        target: { type: "tab", descriptor: tabDescriptor("ai-rules") },
        hasChildren: false,
      },
      {
        id: "section:workspaces",
        label: "工作区",
        icon: Boxes,
        nodeKind: "section",
        hasChildren: true,
      },
    ]
  }

  const mod = moduleById(moduleId)
  return mod.entries.map(entryNode)
}

/** subscriptions 模块: 关注流条目 + feed 子树。 */
export function subscriptionsTreeRoots(): SidebarTreeNode[] {
  const mod = moduleById("subscriptions")
  return mod.entries.map((e) => ({
    ...entryNode(e),
    id: `section:subscriptions`,
    nodeKind: "section" as const,
    childKinds: ["feed"] as NodeKind[],
    hasChildren: true,
  }))
}

/** info 模块: 侧栏展示已关注的实体。 */
export function infoTreeRoots(): SidebarTreeNode[] {
  return [
    {
      id: "section:entities",
      label: "关注的实体",
      icon: Tag,
      nodeKind: "section",
      childResourceQuery: { scheme: "info", kind: "entity" },
      hasChildren: true,
    },
  ]
}

/** community 模块: 侧栏展示已关注的社区发布者 (peer)。 */
export function communityTreeRoots(): SidebarTreeNode[] {
  return [
    {
      id: "section:peers",
      label: "关注的发布者",
      icon: Users,
      nodeKind: "section",
      childResourceQuery: { scheme: "community", kind: "peer" },
      hasChildren: true,
    },
  ]
}

/** 浏览器模块: 侧栏仅展示收藏夹目录与书签 (点击书签 → 内嵌浏览器导航)。 */
export function browserTreeRoots(): SidebarTreeNode[] {
  return [
    {
      id: "section:bookmarks",
      label: "书签",
      icon: Bookmark,
      nodeKind: "section",
      childKinds: ["folder", "bookmark"],
      hasChildren: true,
    },
  ]
}
