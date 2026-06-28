"use client"

// 二级侧栏统一文件树 —— 所有模式共用: 静态根 (区段/面板) + 懒加载 node 子树。
// 点击区段/面板 → openTab (标签栏显示「面板」); 点击具体 node → openNodeTab (显示「内容」)。

import * as React from "react"
import { ChevronRight, Rss } from "lucide-react"
import { cn } from "@/lib/utils"
import { buildTree, type Tree } from "@/files/notes-tree-util"
import { listNodeSummaries, type NodeSummary } from "@/files/stores/nodes-store"
import {
  listSubscriptionsByTypes,
} from "@/files/stores/subscriptions-store"
import type { NodeKind } from "@protocol/node"
import type { Subscription } from "@protocol/subscription"
import { onFilesUpdated } from "@protocol/flowback"
import {
  staticTreeRoots,
  subscriptionsTreeRoots,
  infoTreeRoots,
  communityTreeRoots,
  browserTreeRoots,
  type SidebarTreeNode,
} from "./sidebar-tree-data"
import { requestEmbedRoute } from "@/plugins/embed/embed-nav"
import {
  openTab,
  openNodeTab,
  openAiTasks,
  openAiSection,
  tabKey,
  useActiveId,
  useActiveModule,
  useActiveTabKind,
  useActiveWorkspaceId,
  getTabs,
} from "../store"
import { parseNodeParams } from "../node-tab"
import {
  getWorkspacesState,
  getServerWorkspacesState,
  subscribeWorkspaces,
} from "@/plugins/agent/lib/agent-workspace"
import { subscribeSidebarTreeRefresh } from "./sidebar-tree-bus"
import { DraggableNodeForest } from "./draggable-node-forest"
import { NodeTreeBranch } from "./sidebar-tree-node-branch"
import type { ModuleId } from "../types"

const NotesSidebarTree = React.lazy(
  () => import("@/modules/home/notes/notes-sidebar-tree"),
)

const EXPANDED_KEY = "ideall:sidebar-tree:expanded"

function rootsForModule(moduleId: ModuleId): SidebarTreeNode[] {
  if (moduleId === "browser") return browserTreeRoots()
  if (moduleId === "subscriptions") return subscriptionsTreeRoots()
  if (moduleId === "info") return infoTreeRoots()
  if (moduleId === "community") return communityTreeRoots()
  return staticTreeRoots(moduleId)
}

function defaultExpandedSection(moduleId: ModuleId): string | null {
  if (moduleId === "browser") return "section:bookmarks"
  if (moduleId === "info") return "section:entities"
  if (moduleId === "community") return "section:peers"
  return null
}

function entityEmbedRoute(sub: Subscription): string | null {
  const label = sub.entityLabel ?? ""
  const name = sub.entityName ?? sub.title
  if (!label || !name) return null
  return `/info/entity?label=${encodeURIComponent(label)}&name=${encodeURIComponent(name)}`
}

function isBookmarkTreeSection(childKinds?: NodeKind[]): boolean {
  return Boolean(childKinds?.includes("bookmark") || childKinds?.includes("folder"))
}

function peerEmbedRoute(sub: Subscription): string {
  const q = new URLSearchParams({ openPeer: sub.key, openPeerName: sub.title })
  return `/community?${q.toString()}`
}

function isNodeActive(activeId: string | null, kind: NodeKind, id: string): boolean {
  if (!activeId) return false
  const t = getTabs().find((x) => x.id === activeId)
  if (!t || t.kind !== "node") return false
  const ref = parseNodeParams(t.params)
  return ref?.kind === kind && ref.id === id
}

function isDescriptorActive(
  activeId: string | null,
  descriptor?: SidebarTreeNode["descriptor"],
): boolean {
  if (!activeId || !descriptor) return false
  return activeId === tabKey(descriptor)
}

export default function SidebarTree() {
  const activeModule = useActiveModule()
  const activeId = useActiveId()
  const activeKind = useActiveTabKind()
  const activeWorkspaceId = useActiveWorkspaceId()

  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set())
  const [nodeCache, setNodeCache] = React.useState<Map<string, NodeSummary[]>>(new Map())
  const [subscriptionCache, setSubscriptionCache] = React.useState<Map<string, Subscription[]>>(
    new Map(),
  )

  const wsState = React.useSyncExternalStore(
    subscribeWorkspaces,
    getWorkspacesState,
    getServerWorkspacesState,
  )

  const clearCaches = React.useCallback(() => {
    setNodeCache(new Map())
    setSubscriptionCache(new Map())
  }, [])

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(EXPANDED_KEY)
      if (raw) setExpanded(new Set(JSON.parse(raw) as string[]))
    } catch {
      /* ignore */
    }
  }, [])

  React.useEffect(() => {
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expanded]))
    } catch {
      /* ignore */
    }
  }, [expanded])

  const toggleExpand = React.useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const loadNodes = React.useCallback(async (sectionId: string, kinds: NodeKind[]) => {
    if (kinds.length === 0) return
    try {
      const nodes = await listNodeSummaries(kinds)
      setNodeCache((prev) => new Map(prev).set(sectionId, nodes))
    } catch {
      /* ignore */
    }
  }, [])

  const loadSubscriptions = React.useCallback(
    async (sectionId: string, types: Subscription["type"][]) => {
      if (types.length === 0) return
      try {
        const subs = await listSubscriptionsByTypes(types)
        setSubscriptionCache((prev) => new Map(prev).set(sectionId, subs))
      } catch {
        /* ignore */
      }
    },
    [],
  )

  React.useEffect(() => subscribeSidebarTreeRefresh(clearCaches), [clearCaches])
  React.useEffect(() => onFilesUpdated(clearCaches), [clearCaches])

  React.useEffect(() => {
    const sectionId = defaultExpandedSection(activeModule)
    if (!sectionId) return
    setExpanded((prev) => {
      if (prev.has(sectionId)) return prev
      const next = new Set(prev)
      next.add(sectionId)
      return next
    })
  }, [activeModule])

  React.useEffect(() => {
    const roots = rootsForModule(activeModule)
    for (const root of roots) {
      if (root.id === "section:notes") continue
      if (!expanded.has(root.id)) continue
      if (root.childKinds?.length && !nodeCache.has(root.id)) {
        void loadNodes(root.id, root.childKinds)
      }
      if (root.subscriptionTypes?.length && !subscriptionCache.has(root.id)) {
        void loadSubscriptions(root.id, root.subscriptionTypes)
      }
    }
  }, [
    activeModule,
    expanded,
    nodeCache,
    subscriptionCache,
    loadNodes,
    loadSubscriptions,
  ])

  const roots = React.useMemo(() => {
    if (activeModule === "agent") {
      const base = staticTreeRoots("agent")
      const wsSection = base.find((n) => n.id === "section:workspaces")
      if (wsSection) wsSection.hasChildren = wsState.workspaces.length > 0
      return base
    }
    return rootsForModule(activeModule)
  }, [activeModule, wsState.workspaces.length])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-2">
      <nav className="flex flex-col gap-0.5">
        {roots.map((node) => (
          <TreeRow
            key={node.id}
            node={node}
            depth={0}
            expanded={expanded}
            activeId={activeId}
            activeKind={activeKind}
            activeWorkspaceId={activeWorkspaceId}
            nodeCache={nodeCache}
            subscriptionCache={subscriptionCache}
            workspaces={activeModule === "agent" ? wsState.workspaces : undefined}
            activeModule={activeModule}
            onToggle={toggleExpand}
            onLoadNodes={loadNodes}
            onLoadSubscriptions={loadSubscriptions}
          />
        ))}
      </nav>
    </div>
  )
}

function TreeRow({
  node,
  depth,
  expanded,
  activeId,
  activeKind,
  activeWorkspaceId,
  nodeCache,
  subscriptionCache,
  workspaces,
  activeModule,
  onToggle,
  onLoadNodes,
  onLoadSubscriptions,
}: {
  node: SidebarTreeNode
  depth: number
  expanded: Set<string>
  activeId: string | null
  activeKind: string | null
  activeWorkspaceId: string | null
  nodeCache: Map<string, NodeSummary[]>
  subscriptionCache: Map<string, Subscription[]>
  workspaces?: { id: string; name: string }[]
  activeModule: ModuleId
  onToggle: (id: string) => void
  onLoadNodes: (sectionId: string, kinds: NodeKind[]) => void
  onLoadSubscriptions: (sectionId: string, types: Subscription["type"][]) => void
}) {
  const Icon = node.icon
  const isOpen = expanded.has(node.id)
  const subscriptions = subscriptionCache.get(node.id)

  const active =
    node.nodeKind === "node" && node.nodeRef
      ? isNodeActive(activeId, node.nodeRef.kind, node.nodeRef.id)
      : node.descriptor?.kind === "ai-tasks"
        ? activeWorkspaceId === node.descriptor.params?.workspaceId
        : node.descriptor?.kind?.startsWith("ai-")
          ? activeKind === node.descriptor.kind
          : isDescriptorActive(activeId, node.descriptor)

  const ensureChildrenLoaded = () => {
    if (node.childKinds?.length && node.id !== "section:notes" && !nodeCache.has(node.id)) {
      onLoadNodes(node.id, node.childKinds)
    }
    if (node.subscriptionTypes?.length && !subscriptionCache.has(node.id)) {
      onLoadSubscriptions(node.id, node.subscriptionTypes)
    }
  }

  const handleClick = () => {
    if (node.nodeKind === "node" && node.nodeRef) {
      openNodeTab(node.nodeRef, node.label)
      return
    }
    if (node.descriptor?.kind === "ai-tasks" && node.descriptor.params?.workspaceId) {
      openAiTasks(node.descriptor.params.workspaceId, node.descriptor.title)
      return
    }
    if (node.descriptor?.kind === "ai-mcp") {
      openAiSection("ai-mcp")
      return
    }
    if (node.descriptor?.kind === "ai-skills") {
      openAiSection("ai-skills")
      return
    }
    if (node.descriptor?.kind === "ai-rules") {
      openAiSection("ai-rules")
      return
    }
    if (node.descriptor) openTab(node.descriptor)
    if (node.hasChildren && !isOpen) {
      onToggle(node.id)
      ensureChildrenLoaded()
    }
  }

  const handleChevron = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!node.hasChildren) return
    onToggle(node.id)
    if (!isOpen) ensureChildrenLoaded()
  }

  const forest: Tree<NodeSummary>[] =
    isOpen && node.childKinds?.length && node.id !== "section:notes"
      ? buildTree(nodeCache.get(node.id) ?? [])
      : []

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            handleClick()
          }
        }}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        aria-current={active ? "page" : undefined}
        aria-expanded={node.hasChildren ? isOpen : undefined}
        className={cn(
          "group flex cursor-pointer items-center gap-1 rounded-shell py-1.5 pr-1 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          active
            ? "bg-primary/10 font-medium text-primary"
            : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        )}
      >
        <button
          type="button"
          onClick={handleChevron}
          className={cn(
            "grid h-5 w-5 shrink-0 place-items-center rounded text-muted-foreground transition-transform hover:bg-accent",
            !node.hasChildren && "invisible",
            isOpen && "rotate-90",
          )}
          aria-label={isOpen ? "折叠" : "展开"}
          aria-expanded={node.hasChildren ? isOpen : undefined}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">{node.label}</span>
      </div>

      {isOpen &&
        node.id === "section:workspaces" &&
        workspaces?.map((ws) => {
          const wsActive = activeWorkspaceId === ws.id
          return (
            <div
              key={ws.id}
              role="button"
              tabIndex={0}
              onClick={() => openAiTasks(ws.id, ws.name)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  openAiTasks(ws.id, ws.name)
                }
              }}
              style={{ paddingLeft: `${(depth + 1) * 12 + 4}px` }}
              aria-current={wsActive ? "page" : undefined}
              className={cn(
                "flex cursor-pointer items-center gap-1.5 rounded-shell py-1.5 pr-1 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                wsActive
                  ? "bg-primary/10 font-medium text-primary"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              <span className="h-5 w-5 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-left">{ws.name}</span>
            </div>
          )
        })}

      {isOpen && node.id === "section:notes" && (
        <React.Suspense fallback={null}>
          <NotesSidebarTree depth={depth + 1} />
        </React.Suspense>
      )}

      {isOpen &&
        node.subscriptionTypes?.length &&
        subscriptions?.map((sub) => (
          <SubscriptionRow
            key={sub.id}
            sub={sub}
            depth={depth + 1}
            activeModule={activeModule}
          />
        ))}

      {isOpen && node.subscriptionTypes?.length && subscriptions?.length === 0 && (
        <p
          style={{ paddingLeft: `${(depth + 1) * 12 + 28}px` }}
          className="py-1.5 text-xs text-muted-foreground"
        >
          暂无关注
        </p>
      )}

      {isBookmarkTreeSection(node.childKinds) ? (
        <DraggableNodeForest
          forest={forest}
          flatItems={nodeCache.get(node.id) ?? []}
          sectionId={node.id}
          childKinds={node.childKinds ?? []}
          depth={depth + 1}
          expanded={expanded}
          activeId={activeId}
          activeModule={activeModule}
          onToggle={onToggle}
          onLoadNodes={onLoadNodes}
        />
      ) : (
        forest.map(({ item, children }) => (
          <NodeTreeBranch
            key={item.id}
            item={item}
            childNodes={children}
            depth={depth + 1}
            expanded={expanded}
            activeId={activeId}
            activeModule={activeModule}
            onToggle={onToggle}
          />
        ))
      )}
    </div>
  )
}

function SubscriptionRow({
  sub,
  depth,
  activeModule,
}: {
  sub: Subscription
  depth: number
  activeModule: ModuleId
}) {
  const handleClick = () => {
    if (activeModule === "info" && sub.type === "entity") {
      const route = entityEmbedRoute(sub)
      if (route) requestEmbedRoute("info", route)
      return
    }
    if (activeModule === "community" && sub.type === "peer") {
      requestEmbedRoute("community", peerEmbedRoute(sub))
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          handleClick()
        }
      }}
      style={{ paddingLeft: `${depth * 12 + 4}px` }}
      className={cn(
        "group flex cursor-pointer items-center gap-1 rounded-shell py-1.5 pr-1 text-sm transition-colors",
        "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      <span className="h-5 w-5 shrink-0" />
      {sub.favicon ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={sub.favicon} alt="" className="h-3.5 w-3.5 shrink-0 rounded-[3px]" />
      ) : (
        <Rss className="h-3.5 w-3.5 shrink-0" />
      )}
      <span className="min-w-0 flex-1 truncate text-left">{sub.title || sub.key}</span>
    </div>
  )
}
