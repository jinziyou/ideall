"use client"

// 侧栏跨 kind 文件树 (一切皆文件, 只读导航): 读统一 Node 库的某命名空间节点, 按 parentId/sortKey 建树。
// 复用 notes-tree-util 的泛型 buildTree (与笔记页树同一建树逻辑, 不 fork)。展开/折叠 + 点击打开实体。
// 编辑 (新建/改名/删除/拖拽换父) 仍在各 kind 管理器内; 此处专注导航, 故不带编辑操作。
import * as React from "react"
import {
  Bookmark,
  Bot,
  ChevronRight,
  File as FileIcon,
  FileText,
  Folder,
  Loader2,
  Rss,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { onFilesUpdated } from "@protocol/flowback"
import type { NodeKind } from "@protocol/node"
import { listNodeSummaries, type NodeSummary } from "@/files/stores/nodes-store"
import { buildTree, type Tree } from "@/files/notes-tree-util"
import type { NodeRef } from "./node-ref"

const KIND_ICON: Record<NodeKind, React.ComponentType<{ className?: string }>> = {
  note: FileText,
  bookmark: Bookmark,
  folder: Folder,
  file: FileIcon,
  feed: Rss,
  thread: Bot,
}

export function NodeTree({
  kinds,
  onOpen,
  emptyHint,
}: {
  kinds: NodeKind[]
  onOpen: (ref: NodeRef, title: string) => void
  emptyHint: string
}) {
  const [items, setItems] = React.useState<NodeSummary[] | null>(null)
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set())

  // kinds 数组按值稳定化作 effect 依赖 (避免父组件每渲染新数组引用导致重复加载)。
  // 切换 place 由父组件以 key=place.id 重挂本组件 → 自然回到加载态 + 清空展开集 (无需 effect 内 setState),
  // 故 kindKey 在单次挂载内恒定; effect 仅负责首载 + 订阅 FILES_UPDATED 刷新。
  const kindKey = kinds.join(",")
  React.useEffect(() => {
    let alive = true
    const load = () => {
      listNodeSummaries(kindKey ? (kindKey.split(",") as NodeKind[]) : [])
        .then((r) => {
          if (alive) setItems(r)
        })
        .catch(() => {
          if (alive) setItems([])
        })
    }
    load()
    // 任意回流到「我的」/ 跨端同步后实时刷新文件树。
    const off = onFilesUpdated(load)
    return () => {
      alive = false
      off()
    }
  }, [kindKey])

  const forest = React.useMemo(() => (items ? buildTree(items) : []), [items])

  const toggle = React.useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  if (items === null) {
    return (
      <div className="flex items-center justify-center py-6 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    )
  }
  if (forest.length === 0) {
    return <p className="px-2 py-4 text-xs leading-relaxed text-muted-foreground">{emptyHint}</p>
  }
  return (
    <div className="flex flex-col">
      {forest.map((n) => (
        <NodeRow
          key={n.item.id}
          node={n}
          depth={0}
          expanded={expanded}
          onToggle={toggle}
          onOpen={onOpen}
        />
      ))}
    </div>
  )
}

function NodeRow({
  node,
  depth,
  expanded,
  onToggle,
  onOpen,
}: {
  node: Tree<NodeSummary>
  depth: number
  expanded: Set<string>
  onToggle: (id: string) => void
  onOpen: (ref: NodeRef, title: string) => void
}) {
  const it = node.item
  const Icon = KIND_ICON[it.kind] ?? FileText
  const isOpen = expanded.has(it.id)
  const hasKids = node.children.length > 0
  const isFolder = it.kind === "folder"

  return (
    <div>
      <div
        // 容器节点 (folder) 点击 = 展开/折叠 (无独立查看器); 其余 kind 点击 = 打开实体标签。
        onClick={() =>
          isFolder ? onToggle(it.id) : onOpen({ kind: it.kind, id: it.id }, it.title)
        }
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
        className="group flex cursor-pointer items-center gap-1 rounded-md py-1 pr-1 text-sm transition-colors hover:bg-accent/60"
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            if (hasKids) onToggle(it.id)
          }}
          className={cn(
            "grid h-4 w-4 shrink-0 place-items-center rounded text-muted-foreground transition-transform hover:bg-accent",
            !hasKids && "invisible",
            isOpen && "rotate-90",
          )}
          aria-label={isOpen ? "折叠" : "展开"}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate" title={it.title || "无标题"}>
          {it.title || <span className="text-muted-foreground">无标题</span>}
        </span>
      </div>
      {isOpen &&
        node.children.map((c) => (
          <NodeRow
            key={c.item.id}
            node={c}
            depth={depth + 1}
            expanded={expanded}
            onToggle={onToggle}
            onOpen={onOpen}
          />
        ))}
    </div>
  )
}
