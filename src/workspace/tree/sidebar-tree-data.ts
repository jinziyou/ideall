// 二级侧栏文件树的模块→节点 kind 映射与静态根节点构造。
// 动态子节点 (note/bookmark/feed 等) 由 sidebar-tree.tsx 经 listNodeSummaries 懒加载。

import type { ComponentType } from "react"
import {
  Bookmark,
  Boxes,
  FileText,
  Folder,
  Link2,
  Plug,
  Rss,
  ScrollText,
  Sparkles,
  Tag,
  Users,
} from "lucide-react"
import type { NodeKind } from "@protocol/node"
import type { SubscriptionType } from "@protocol/subscription"
import type { TabDescriptor } from "../types"
import type { ModuleId } from "../types"
import { HOME_SECTIONS } from "./home-sections"
import { moduleById } from "../modules"
import type { SidebarEntry } from "../modules"

export type SidebarTreeNodeKind = "section" | "entry" | "node"

export type SidebarTreeNode = {
  id: string
  label: string
  icon: ComponentType<{ className?: string }>
  nodeKind: SidebarTreeNodeKind
  /** 点区段/面板条目 → 开面板标签 */
  descriptor?: TabDescriptor
  /** 点具体节点 → 开内容标签 */
  nodeRef?: { kind: NodeKind; id: string }
  /** 展开后懒加载的子节点 kind (仅 section 有效) */
  childKinds?: NodeKind[]
  /** 展开后按关注类型加载 (info/community 侧栏) */
  subscriptionTypes?: SubscriptionType[]
  hasChildren: boolean
}

const NODE_ICON: Partial<Record<NodeKind, ComponentType<{ className?: string }>>> = {
  note: FileText,
  bookmark: Link2,
  folder: Folder,
  file: FileText,
  feed: Rss,
  thread: ScrollText,
}

export function iconForNodeKind(kind: NodeKind): ComponentType<{ className?: string }> {
  return NODE_ICON[kind] ?? FileText
}

/** 各 home 区段展开时加载的 node kind。 */
const HOME_SECTION_KINDS: Record<string, NodeKind[]> = {
  subscriptions: ["feed"],
  bookmarks: ["folder", "bookmark"],
  resources: ["file"],
  publications: [],
  notes: ["note"],
  // 对话即文件 (§6.5): thread 与笔记/书签一样可从树寻址。
  threads: ["thread"],
}

function entryNode(e: SidebarEntry): SidebarTreeNode {
  return {
    id: `entry:${e.descriptor.kind}`,
    label: e.label,
    icon: e.icon,
    nodeKind: "entry",
    descriptor: e.descriptor,
    hasChildren: false,
  }
}

/** 按当前活动模块构造侧栏树的静态根 (不含 IndexedDB 子节点)。 */
export function staticTreeRoots(moduleId: ModuleId): SidebarTreeNode[] {
  if (moduleId === "home") {
    return HOME_SECTIONS.map((s) => ({
      id: `section:${s.id}`,
      label: s.label,
      icon: s.icon,
      nodeKind: "section" as const,
      descriptor: s.descriptor,
      childKinds: HOME_SECTION_KINDS[s.id] ?? [],
      hasChildren: (HOME_SECTION_KINDS[s.id]?.length ?? 0) > 0,
    }))
  }

  if (moduleId === "agent") {
    return [
      {
        id: "entry:ai-mcp",
        label: "MCP",
        icon: Plug,
        nodeKind: "entry",
        descriptor: { kind: "ai-mcp", module: "agent", title: "MCP" },
        hasChildren: false,
      },
      {
        id: "entry:ai-skills",
        label: "Skills",
        icon: Sparkles,
        nodeKind: "entry",
        descriptor: { kind: "ai-skills", module: "agent", title: "Skills" },
        hasChildren: false,
      },
      {
        id: "entry:ai-rules",
        label: "规则",
        icon: ScrollText,
        nodeKind: "entry",
        descriptor: { kind: "ai-rules", module: "agent", title: "规则" },
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
      subscriptionTypes: ["entity"],
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
      subscriptionTypes: ["peer"],
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
