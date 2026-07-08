"use client"

// 二级侧栏统一文件树 —— 所有模式共用: 静态根 (区段/面板) + 懒加载 node/resource 子树。
// 点击区段/面板/具体资源 → OpenTarget。

import * as React from "react"
import { ChevronRight, Rss } from "lucide-react"
import { cn } from "@/lib/utils"
import { buildTree, type Tree } from "@/files/notes-tree-util"
import { listNodeSummaries, type NodeSummary } from "@/files/stores/nodes-store"
import type { NodeKind } from "@protocol/node"
import type { ResourceMeta } from "@protocol/resource"
import { listResources, watchResources } from "@/vfs/registry"
import type { ResourceQuery } from "@/vfs/types"
import {
  staticTreeRoots,
  subscriptionsTreeRoots,
  infoTreeRoots,
  communityTreeRoots,
  browserTreeRoots,
  type SidebarTreeNode,
} from "./sidebar-tree-data"
import {
  openTarget,
  openAiTasks,
  openAiSection,
  tabKey,
  useActiveId,
  useActiveModule,
  useMode,
  useActiveTabKind,
  useActiveWorkspaceId,
  getTabs,
} from "../store"
import { descriptorForResource, descriptorForResourceMeta, type OpenTarget } from "../open-target"
import { parseNodeParams } from "../node-tab"
import { resolveResourceEngine } from "../resource-engines"
import {
  getWorkspacesState,
  getServerWorkspacesState,
  subscribeWorkspaces,
} from "@/plugins/agent/lib/agent-workspace"
import { refreshSidebarTree, subscribeSidebarTreeRefresh } from "./sidebar-tree-bus"
import { DraggableNodeForest } from "./draggable-node-forest"
import { NodeTreeBranch } from "./sidebar-tree-node-branch"
import { onTreeArrowNav, focusTreeSibling, forwardTreeFocus } from "./tree-keynav"
import type { ModuleId } from "../types"
import { isPluginModule } from "../plugin-entries"

const NotesSidebarTree = React.lazy(() => import("@/modules/home/notes/notes-sidebar-tree"))

const EXPANDED_KEY = "ideall:sidebar-tree:expanded"

function rootsForModule(moduleId: ModuleId): SidebarTreeNode[] {
  const id = isPluginModule(moduleId) ? "plugins" : moduleId
  if (id === "browser") return browserTreeRoots()
  if (id === "subscriptions") return subscriptionsTreeRoots()
  if (id === "info") return infoTreeRoots()
  if (id === "community") return communityTreeRoots()
  return staticTreeRoots(id)
}

function defaultExpandedSection(moduleId: ModuleId): string | null {
  if (moduleId === "home") return "section:workspace"
  if (moduleId === "browser") return "section:bookmarks"
  if (moduleId === "info") return "section:entities"
  if (moduleId === "community") return "section:peers"
  return null
}

function isBookmarkTreeSection(childKinds?: NodeKind[]): boolean {
  return Boolean(childKinds?.includes("bookmark") || childKinds?.includes("folder"))
}

function isNodeActive(activeId: string | null, kind: NodeKind, id: string): boolean {
  if (!activeId) return false
  const t = getTabs().find((x) => x.id === activeId)
  if (!t || t.kind !== "node") return false
  const ref = parseNodeParams(t.params)
  return ref?.kind === kind && ref.id === id
}

function isTabTargetActive(
  activeId: string | null,
  target: Extract<OpenTarget, { type: "tab" }>,
  activeKind: string | null,
  activeWorkspaceId: string | null,
): boolean {
  const descriptor = target.descriptor
  if (descriptor.kind === "ai-tasks") {
    return activeWorkspaceId === descriptor.params?.workspaceId
  }
  if (descriptor.kind.startsWith("ai-")) return activeKind === descriptor.kind
  return activeId === tabKey(descriptor)
}

function isResourceTargetActive(
  activeId: string | null,
  target: Extract<OpenTarget, { type: "resource" }>,
): boolean {
  if (!activeId) return false
  if (target.ref.scheme === "node") return isNodeActive(activeId, target.ref.kind, target.ref.id)
  const descriptor = target.meta
    ? descriptorForResourceMeta(target.meta)
    : descriptorForResource(target.ref, target.title)
  return descriptor ? activeId === tabKey(descriptor) : false
}

function isTargetActive(
  activeId: string | null,
  target: OpenTarget | undefined,
  activeKind: string | null,
  activeWorkspaceId: string | null,
): boolean {
  if (!target) return false
  if (target.type === "tab")
    return isTabTargetActive(activeId, target, activeKind, activeWorkspaceId)
  if (target.type === "resource") return isResourceTargetActive(activeId, target)
  return false
}

function openTreeTarget(target: OpenTarget, transient: boolean) {
  if (target.type === "resource") openTarget({ ...target, transient }, "user")
  else if (target.type === "tab") openTarget({ ...target, transient }, "user")
  else openTarget(target, "user")
}

export default function SidebarTree() {
  const activeModule = useActiveModule()
  const mode = useMode()
  const activeId = useActiveId()
  const activeKind = useActiveTabKind()
  const activeWorkspaceId = useActiveWorkspaceId()

  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set())
  const [nodeCache, setNodeCache] = React.useState<Map<string, NodeSummary[]>>(new Map())
  const [resourceCache, setResourceCache] = React.useState<Map<string, ResourceMeta[]>>(new Map())

  const wsState = React.useSyncExternalStore(
    subscribeWorkspaces,
    getWorkspacesState,
    getServerWorkspacesState,
  )

  const clearCaches = React.useCallback(() => {
    setNodeCache(new Map())
    setResourceCache(new Map())
  }, [])

  const invalidateSection = React.useCallback((sectionId: string) => {
    setNodeCache((prev) => {
      if (!prev.has(sectionId)) return prev
      const next = new Map(prev)
      next.delete(sectionId)
      return next
    })
    setResourceCache((prev) => {
      if (!prev.has(sectionId)) return prev
      const next = new Map(prev)
      next.delete(sectionId)
      return next
    })
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

  const loadResourceChildren = React.useCallback(
    async (sectionId: string, query: ResourceQuery) => {
      try {
        const page = await listResources(query, { actor: "ui", permissions: [] })
        setResourceCache((prev) => new Map(prev).set(sectionId, page.items))
      } catch {
        /* ignore */
      }
    },
    [],
  )

  React.useEffect(() => subscribeSidebarTreeRefresh(clearCaches), [clearCaches])

  React.useEffect(() => {
    const disposers: Array<() => void> = []
    const watchNode = (node: SidebarTreeNode) => {
      if (node.childKinds?.length) {
        try {
          const handle = watchResources(
            { scheme: "node", kinds: node.childKinds },
            { actor: "ui", permissions: [] },
            () => {
              invalidateSection(node.id)
              if (node.id === "section:notes") refreshSidebarTree()
            },
          )
          if (handle) disposers.push(() => handle.dispose())
        } catch {
          /* provider may not be registered during early boot */
        }
      }
      if (node.childResourceQuery) {
        try {
          const handle = watchResources(
            node.childResourceQuery,
            { actor: "ui", permissions: [] },
            () => invalidateSection(node.id),
          )
          if (handle) disposers.push(() => handle.dispose())
        } catch {
          /* provider may not be registered during early boot */
        }
      }
      node.staticChildren?.forEach(watchNode)
    }
    rootsForModule(activeModule).forEach(watchNode)
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, [activeModule, invalidateSection])

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
      if (root.childResourceQuery && !resourceCache.has(root.id)) {
        void loadResourceChildren(root.id, root.childResourceQuery)
      }
    }
  }, [activeModule, expanded, nodeCache, resourceCache, loadNodes, loadResourceChildren])

  const roots = React.useMemo(() => {
    if (activeModule === "agent") {
      const base = staticTreeRoots("agent").filter(
        (n) => mode === "local" || n.id !== "section:workspaces",
      )
      const wsSection = base.find((n) => n.id === "section:workspaces")
      if (wsSection) wsSection.hasChildren = wsState.workspaces.length > 0
      return base
    }
    return rootsForModule(activeModule)
  }, [activeModule, mode, wsState.workspaces.length])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-2">
      {/* WAI-ARIA 树: 容器 role=tree, 每行 role=treeitem + aria-level; 方向键导航见 tree-keynav。
          roving 单停靠点: 容器是整棵树唯一的 Tab 停靠 (行均 tabIndex=-1), 聚焦转发见 forwardTreeFocus。 */}
      <nav
        role="tree"
        aria-label="文件树"
        tabIndex={0}
        onFocus={forwardTreeFocus}
        className="flex flex-col gap-0.5 outline-none"
      >
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
            resourceCache={resourceCache}
            workspaces={activeModule === "agent" ? wsState.workspaces : undefined}
            activeModule={activeModule}
            onToggle={toggleExpand}
            onLoadNodes={loadNodes}
            onLoadResourceChildren={loadResourceChildren}
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
  resourceCache,
  workspaces,
  activeModule,
  onToggle,
  onLoadNodes,
  onLoadResourceChildren,
}: {
  node: SidebarTreeNode
  depth: number
  expanded: Set<string>
  activeId: string | null
  activeKind: string | null
  activeWorkspaceId: string | null
  nodeCache: Map<string, NodeSummary[]>
  resourceCache: Map<string, ResourceMeta[]>
  workspaces?: { id: string; name: string }[]
  activeModule: ModuleId
  onToggle: (id: string) => void
  onLoadNodes: (sectionId: string, kinds: NodeKind[]) => void
  onLoadResourceChildren: (sectionId: string, query: ResourceQuery) => void
}) {
  const Icon = node.icon
  const isOpen = expanded.has(node.id)
  const resources = resourceCache.get(node.id)

  const active = isTargetActive(activeId, node.target, activeKind, activeWorkspaceId)

  const ensureChildrenLoaded = () => {
    if (node.childKinds?.length && node.id !== "section:notes" && !nodeCache.has(node.id)) {
      onLoadNodes(node.id, node.childKinds)
    }
    if (node.childResourceQuery && !resourceCache.has(node.id)) {
      onLoadResourceChildren(node.id, node.childResourceQuery)
    }
  }

  // 行点击语义 (VS Code 式): 单击 = 预览 (transient, 复用单一预览槽, 随手看不堆标签);
  // 双击 / 键盘 Enter = 常驻 (固定)。纯容器行 (无 descriptor) 则单击 = 双向展开/折叠。
  const openRow = (transient: boolean) => {
    const descriptor = node.target?.type === "tab" ? node.target.descriptor : null
    if (descriptor?.kind === "ai-tasks" && descriptor.params?.workspaceId) {
      openAiTasks(descriptor.params.workspaceId, descriptor.title, { transient })
      return
    }
    if (descriptor?.kind === "ai-mcp") {
      openAiSection("ai-mcp", { transient })
      return
    }
    if (descriptor?.kind === "ai-skills") {
      openAiSection("ai-skills", { transient })
      return
    }
    if (descriptor?.kind === "ai-rules") {
      openAiSection("ai-rules", { transient })
      return
    }
    if (node.target) {
      openTreeTarget(node.target, transient)
      return
    }
    // 纯容器 (无 descriptor 的 section/文件夹): 行点击 = 双向展开/折叠 (修复「已展开时点行无反馈」死区)。
    if (node.hasChildren) {
      onToggle(node.id)
      if (!isOpen) ensureChildrenLoaded()
    }
  }

  const handleClick = () => openRow(true)
  // 双击 → 把预览标签固定成常驻 (走非瞬态打开, 命中预览槽即提升; 纯容器行无视)。
  const handleDoubleClick = () => {
    if (node.target) openRow(false)
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
        role="treeitem"
        tabIndex={-1}
        aria-level={depth + 1}
        aria-selected={active || undefined}
        aria-expanded={node.hasChildren ? isOpen : undefined}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onKeyDown={(e) => {
          if (onTreeArrowNav(e)) return
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            openRow(false)
          } else if (e.key === "ArrowRight") {
            if (node.hasChildren && !isOpen) {
              e.preventDefault()
              onToggle(node.id)
              ensureChildrenLoaded()
            } else if (focusTreeSibling(e.currentTarget, 1)) {
              e.preventDefault()
            }
          } else if (e.key === "ArrowLeft") {
            if (node.hasChildren && isOpen) {
              e.preventDefault()
              onToggle(node.id)
            } else if (focusTreeSibling(e.currentTarget, -1)) {
              e.preventDefault()
            }
          }
        }}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        className={cn(
          "group flex cursor-pointer items-center gap-1 rounded-shell py-1.5 pr-1 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          active
            ? "bg-primary/10 font-medium text-primary"
            : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        )}
      >
        {/* 展开箭头: 展示性 (aria-hidden + 非按钮), 避免「行内嵌可聚焦按钮」违反 WCAG 4.1.2 + 双 Tab 停靠/双重朗读;
            键盘展开/折叠走行的 ←/→, 鼠标点箭头仍可 (span onClick + stopPropagation)。 */}
        <span
          aria-hidden="true"
          onClick={handleChevron}
          className={cn(
            "grid h-5 w-5 shrink-0 cursor-pointer place-items-center rounded text-muted-foreground transition-transform hover:bg-accent",
            !node.hasChildren && "invisible",
            isOpen && "rotate-90",
          )}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </span>
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">{node.label}</span>
      </div>

      {isOpen &&
        node.staticChildren?.map((child) => (
          <TreeRow
            key={child.id}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            activeId={activeId}
            activeKind={activeKind}
            activeWorkspaceId={activeWorkspaceId}
            nodeCache={nodeCache}
            resourceCache={resourceCache}
            workspaces={workspaces}
            activeModule={activeModule}
            onToggle={onToggle}
            onLoadNodes={onLoadNodes}
            onLoadResourceChildren={onLoadResourceChildren}
          />
        ))}

      {isOpen &&
        node.id === "section:workspaces" &&
        workspaces?.map((ws) => {
          const wsActive = activeWorkspaceId === ws.id
          return (
            <div
              key={ws.id}
              role="treeitem"
              tabIndex={-1}
              aria-level={depth + 2}
              aria-selected={wsActive || undefined}
              onClick={() => openAiTasks(ws.id, ws.name, { transient: true })}
              onDoubleClick={() => openAiTasks(ws.id, ws.name)}
              onKeyDown={(e) => {
                if (onTreeArrowNav(e)) return
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  openAiTasks(ws.id, ws.name)
                }
              }}
              style={{ paddingLeft: `${(depth + 1) * 12 + 4}px` }}
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
        node.childResourceQuery &&
        resources?.map((resource) => (
          <ResourceRow
            key={resourceKey(resource)}
            meta={resource}
            depth={depth + 1}
            activeId={activeId}
          />
        ))}

      {isOpen && node.childResourceQuery && resources?.length === 0 && (
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

function resourceKey(meta: ResourceMeta): string {
  return `${meta.ref.scheme}:${meta.ref.kind}:${meta.ref.id}`
}

function ResourceRow({
  meta,
  depth,
  activeId,
}: {
  meta: ResourceMeta
  depth: number
  activeId: string | null
}) {
  const Icon = resolveResourceEngine(meta.ref)?.icon ?? Rss
  const target: OpenTarget = { type: "resource", ref: meta.ref, title: meta.title, meta }
  const active = isResourceTargetActive(activeId, target)
  const open = (transient: boolean) => openTreeTarget(target, transient)

  return (
    <div
      role="treeitem"
      tabIndex={-1}
      aria-level={depth + 1}
      aria-selected={active || undefined}
      onClick={() => open(true)}
      onDoubleClick={() => open(false)}
      onKeyDown={(e) => {
        if (onTreeArrowNav(e)) return
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          open(false)
        }
      }}
      style={{ paddingLeft: `${depth * 12 + 4}px` }}
      className={cn(
        "group flex cursor-pointer items-center gap-1 rounded-shell py-1.5 pr-1 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        active
          ? "bg-primary/10 font-medium text-primary"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      <span className="h-5 w-5 shrink-0" />
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-left">{meta.title}</span>
    </div>
  )
}
