"use client"

// 二级侧栏统一文件树 —— 所有模式共用: 静态根 (区段/面板) + 懒加载 node 子树。
// 点击区段/面板 → openTab (标签栏显示「面板」); 点击具体 node → openNodeTab (显示「内容」)。

import * as React from "react"
import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { buildTree, type Tree } from "@/files/notes-tree-util"
import { listNodeSummaries, type NodeSummary } from "@/files/stores/nodes-store"
import type { NodeKind } from "@protocol/node"
import {
  iconForNodeKind,
  staticTreeRoots,
  subscriptionsTreeRoots,
  embedTreeRoots,
  type SidebarTreeNode,
} from "./sidebar-tree-data"
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
} from "./store"
import { parseNodeParams } from "./node-tab"
import SidebarWebSearch from "./sidebar-web-search"
import {
  getWorkspacesState,
  getServerWorkspacesState,
  subscribeWorkspaces,
} from "@/plugins/agent/lib/agent-workspace"
import { moduleById } from "./modules"
import type { ModuleId } from "./types"
import { subscribeSidebarTreeRefresh } from "./sidebar-tree-bus"

const NotesSidebarTree = React.lazy(
  () => import("@/modules/home/notes/notes-sidebar-tree"),
)

const EXPANDED_KEY = "ideall:sidebar-tree:expanded"

function rootsForModule(moduleId: ModuleId): SidebarTreeNode[] {
  // 浏览器由活动栏直达开标签, 侧栏仅保留提示文案, 避免「侧栏入口 + 主区标签」双入口。
  if (moduleId === "browser") return []
  if (moduleId === "subscriptions") return subscriptionsTreeRoots()
  if (moduleId === "info") return embedTreeRoots("info")
  if (moduleId === "community") return embedTreeRoots("community")
  return staticTreeRoots(moduleId)
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
  const mod = moduleById(activeModule)

  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set())
  const [nodeCache, setNodeCache] = React.useState<Map<string, NodeSummary[]>>(new Map())

  const wsState = React.useSyncExternalStore(
    subscribeWorkspaces,
    getWorkspacesState,
    getServerWorkspacesState,
  )

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

  React.useEffect(() => subscribeSidebarTreeRefresh(() => setNodeCache(new Map())), [])

  React.useEffect(() => {
    const roots = rootsForModule(activeModule)
    for (const root of roots) {
      if (root.id === "section:notes") continue
      if (!expanded.has(root.id) || !root.childKinds?.length) continue
      if (nodeCache.has(root.id)) continue
      void loadNodes(root.id, root.childKinds)
    }
  }, [activeModule, expanded, nodeCache, loadNodes])

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
      {activeModule === "tool" && <SidebarWebSearch />}
      {mod.sidebarHint && (
        <p className="px-2 pb-2 pt-1 text-xs leading-relaxed text-muted-foreground">
          {mod.sidebarHint}
        </p>
      )}
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
            workspaces={activeModule === "agent" ? wsState.workspaces : undefined}
            onToggle={toggleExpand}
            onLoadNodes={loadNodes}
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
  workspaces,
  onToggle,
  onLoadNodes,
}: {
  node: SidebarTreeNode
  depth: number
  expanded: Set<string>
  activeId: string | null
  activeKind: string | null
  activeWorkspaceId: string | null
  nodeCache: Map<string, NodeSummary[]>
  workspaces?: { id: string; name: string }[]
  onToggle: (id: string) => void
  onLoadNodes: (sectionId: string, kinds: NodeKind[]) => void
}) {
  const Icon = node.icon
  const isOpen = expanded.has(node.id)

  const active =
    node.nodeKind === "node" && node.nodeRef
      ? isNodeActive(activeId, node.nodeRef.kind, node.nodeRef.id)
      : node.descriptor?.kind === "ai-tasks"
        ? activeWorkspaceId === node.descriptor.params?.workspaceId
        : node.descriptor?.kind?.startsWith("ai-")
          ? activeKind === node.descriptor.kind
          : isDescriptorActive(activeId, node.descriptor)

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
      if (
        node.childKinds?.length &&
        node.id !== "section:notes" &&
        !nodeCache.has(node.id)
      ) {
        onLoadNodes(node.id, node.childKinds)
      }
    }
  }

  const handleChevron = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!node.hasChildren) return
    onToggle(node.id)
    if (
      !isOpen &&
      node.childKinds?.length &&
      node.id !== "section:notes" &&
      !nodeCache.has(node.id)
    ) {
      onLoadNodes(node.id, node.childKinds)
    }
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
          "group flex cursor-pointer items-center gap-1 rounded-shell py-1.5 pr-1 text-sm transition-colors",
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
                "flex cursor-pointer items-center gap-1.5 rounded-shell py-1.5 pr-1 text-sm transition-colors",
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

      {forest.map(({ item, children }) => (
        <NodeTreeBranch
          key={item.id}
          item={item}
          children={children}
          depth={depth + 1}
          expanded={expanded}
          activeId={activeId}
          onToggle={onToggle}
        />
      ))}
    </div>
  )
}

function NodeTreeBranch({
  item,
  children,
  depth,
  expanded,
  activeId,
  onToggle,
}: {
  item: NodeSummary
  children: Tree<NodeSummary>[]
  depth: number
  expanded: Set<string>
  activeId: string | null
  onToggle: (id: string) => void
}) {
  const id = `node:${item.kind}:${item.id}`
  const isOpen = expanded.has(id)
  const Icon = iconForNodeKind(item.kind)
  const active = isNodeActive(activeId, item.kind, item.id)
  const hasKids = children.length > 0

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => openNodeTab({ kind: item.kind, id: item.id }, item.title || "无标题")}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            openNodeTab({ kind: item.kind, id: item.id }, item.title || "无标题")
          }
        }}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        aria-current={active ? "page" : undefined}
        aria-expanded={hasKids ? isOpen : undefined}
        className={cn(
          "group flex cursor-pointer items-center gap-1 rounded-shell py-1.5 pr-1 text-sm transition-colors",
          active
            ? "bg-primary/10 font-medium text-primary"
            : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        )}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            if (hasKids) onToggle(id)
          }}
          className={cn(
            "grid h-5 w-5 shrink-0 place-items-center rounded text-muted-foreground transition-transform hover:bg-accent",
            !hasKids && "invisible",
            isOpen && "rotate-90",
          )}
          aria-label={isOpen ? "折叠" : "展开"}
          aria-expanded={hasKids ? isOpen : undefined}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">{item.title || "无标题"}</span>
      </div>
      {isOpen &&
        children.map((child) => (
          <NodeTreeBranch
            key={child.item.id}
            item={child.item}
            children={child.children}
            depth={depth + 1}
            expanded={expanded}
            activeId={activeId}
            onToggle={onToggle}
          />
        ))}
    </div>
  )
}
