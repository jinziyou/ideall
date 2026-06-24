"use client"

// 递归页树侧栏 —— Notion 式「目录即页面」: 每个节点既是页面又是目录, 可无限嵌套。
// 展开/折叠、添加子页、重命名/删除/移到根, 以及拖拽换父 + 同级重排 (带环检测)。
import * as React from "react"
import { ChevronRight, CornerUpLeft, FileText, MoreHorizontal, Plus, Trash2 } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/components/lib/utils"
import type { NoteMeta } from "../model"
import { buildNoteTree, type TreeNode } from "../lib/notes-tree-util"

/** 拖放落点的相对位置: 目标行上缘=插到其前; 下缘=插到其后; 中部=作其子页。 */
type DropZone = "before" | "after" | "inside"
/** 同级插入位置 (与 notes-store 的 InsertPos 对齐): 省略=末尾, null=开头, 字符串=该键之后。 */
export type InsertPos = { afterSortKey?: string | null }

export function PageTree({
  notes,
  selectedId,
  expanded,
  onSelect,
  onToggle,
  onAddChild,
  onDelete,
  onMove,
}: {
  notes: NoteMeta[]
  selectedId: string | null
  expanded: Set<string>
  onSelect: (id: string) => void
  onToggle: (id: string) => void
  onAddChild: (parentId: string) => void
  onDelete: (note: NoteMeta) => void
  onMove: (dragId: string, newParentId: string | null, pos?: InsertPos) => void
}) {
  const forest = React.useMemo(() => buildNoteTree(notes), [notes])

  // id → { parentId, 有序同级 }, 供拖放计算插入位置。
  const info = React.useMemo(() => {
    const m = new Map<string, { parentId: string | null; ordered: NoteMeta[] }>()
    const walk = (nodes: TreeNode[], parentId: string | null) => {
      const ordered = nodes.map((n) => n.note)
      for (const n of nodes) {
        m.set(n.note.id, { parentId, ordered })
        walk(n.children, n.note.id)
      }
    }
    walk(forest, null)
    return m
  }, [forest])

  const [dragId, setDragId] = React.useState<string | null>(null)
  const [dropHint, setDropHint] = React.useState<{ id: string; zone: DropZone } | null>(null)

  // 目标是否落在被拖节点自身或其子树内 (沿 parentId 向上找到 dragId 即非法, 防环)。
  const isUnder = React.useCallback(
    (nodeId: string, ancestorId: string): boolean => {
      let cur: string | null = nodeId
      const seen = new Set<string>()
      while (cur != null && !seen.has(cur)) {
        if (cur === ancestorId) return true
        seen.add(cur)
        cur = info.get(cur)?.parentId ?? null
      }
      return false
    },
    [info],
  )

  const commitDrop = React.useCallback(
    (targetId: string, zone: DropZone) => {
      const id = dragId
      setDragId(null)
      setDropHint(null)
      if (!id || id === targetId || isUnder(targetId, id)) return
      const t = info.get(targetId)
      if (!t) return
      if (zone === "inside") {
        onMove(id, targetId, undefined) // 作子页, 追加末尾
        return
      }
      const sibs = t.ordered.filter((s) => s.id !== id)
      const targetMeta = t.ordered.find((s) => s.id === targetId)
      if (zone === "after") {
        onMove(id, t.parentId, { afterSortKey: targetMeta?.sortKey })
      } else {
        const ti = sibs.findIndex((s) => s.id === targetId)
        const pos: InsertPos =
          ti <= 0 ? { afterSortKey: null } : { afterSortKey: sibs[ti - 1].sortKey }
        onMove(id, t.parentId, pos)
      }
    },
    [dragId, info, isUnder, onMove],
  )

  if (forest.length === 0) {
    return (
      <div className="rounded-lg border border-dashed py-16 text-center text-sm text-muted-foreground">
        还没有页面。点上方「新建」开始。
      </div>
    )
  }

  return (
    <div
      className="flex flex-col"
      // 拖到列表底部空白 = 移到根末尾
      onDragOver={(e) => {
        if (dragId) e.preventDefault()
      }}
      onDrop={(e) => {
        if (!dragId) return
        e.preventDefault()
        const id = dragId
        setDragId(null)
        setDropHint(null)
        onMove(id, null, undefined)
      }}
    >
      {forest.map((node) => (
        <PageTreeRow
          key={node.note.id}
          node={node}
          depth={0}
          selectedId={selectedId}
          expanded={expanded}
          dragId={dragId}
          dropHint={dropHint}
          onSelect={onSelect}
          onToggle={onToggle}
          onAddChild={onAddChild}
          onDelete={onDelete}
          onMoveRoot={(rid) => onMove(rid, null, undefined)}
          onDragStart={setDragId}
          onDragEnd={() => {
            setDragId(null)
            setDropHint(null)
          }}
          onHint={setDropHint}
          onCommitDrop={commitDrop}
          isUnder={isUnder}
        />
      ))}
    </div>
  )
}

function PageTreeRow({
  node,
  depth,
  selectedId,
  expanded,
  dragId,
  dropHint,
  onSelect,
  onToggle,
  onAddChild,
  onDelete,
  onMoveRoot,
  onDragStart,
  onDragEnd,
  onHint,
  onCommitDrop,
  isUnder,
}: {
  node: TreeNode
  depth: number
  selectedId: string | null
  expanded: Set<string>
  dragId: string | null
  dropHint: { id: string; zone: DropZone } | null
  onSelect: (id: string) => void
  onToggle: (id: string) => void
  onAddChild: (parentId: string) => void
  onDelete: (note: NoteMeta) => void
  onMoveRoot: (id: string) => void
  onDragStart: (id: string) => void
  onDragEnd: () => void
  onHint: (h: { id: string; zone: DropZone } | null) => void
  onCommitDrop: (targetId: string, zone: DropZone) => void
  isUnder: (nodeId: string, ancestorId: string) => boolean
}) {
  const { note, children } = node
  const id = note.id
  const isOpen = expanded.has(id)
  const hasKids = children.length > 0
  const active = selectedId === id
  const invalidTarget = dragId != null && (dragId === id || isUnder(id, dragId))
  const hint = dropHint?.id === id ? dropHint.zone : null

  function zoneFromEvent(e: React.DragEvent): DropZone {
    const r = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - r.top
    if (y < r.height * 0.28) return "before"
    if (y > r.height * 0.72) return "after"
    return "inside"
  }

  return (
    <div>
      <div
        draggable
        onDragStart={(e) => {
          e.stopPropagation()
          e.dataTransfer.effectAllowed = "move"
          onDragStart(id)
        }}
        onDragEnd={onDragEnd}
        onDragOver={(e) => {
          if (!dragId || invalidTarget) return
          e.preventDefault()
          e.stopPropagation()
          onHint({ id, zone: zoneFromEvent(e) })
        }}
        onDragLeave={(e) => {
          e.stopPropagation()
          if (dropHint?.id === id) onHint(null)
        }}
        onDrop={(e) => {
          if (!dragId) return
          // 即便落点非法 (拖到自身/后代) 也要吃掉事件, 否则会冒泡到容器 onDrop 被当成「移到根」。
          e.preventDefault()
          e.stopPropagation()
          if (invalidTarget) return
          onCommitDrop(id, zoneFromEvent(e))
        }}
        onClick={() => onSelect(id)}
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
        className={cn(
          "group relative flex cursor-pointer items-center gap-1 rounded-md py-1 pr-1 text-sm transition-colors",
          active ? "bg-primary/10 font-medium text-primary" : "hover:bg-accent/60",
          hint === "inside" && "bg-primary/15 ring-1 ring-inset ring-primary/40",
        )}
      >
        {/* 上/下缘插入指示线 */}
        {hint === "before" && (
          <span className="pointer-events-none absolute inset-x-1 top-0 h-0.5 rounded bg-primary" />
        )}
        {hint === "after" && (
          <span className="pointer-events-none absolute inset-x-1 bottom-0 h-0.5 rounded bg-primary" />
        )}

        {/* 展开箭头 (仅有子页时可点) */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            if (hasKids) onToggle(id)
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

        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate" title={note.title || "无标题"}>
          {note.title || <span className="text-muted-foreground">无标题</span>}
        </span>

        {/* hover 操作: 添加子页 + 菜单 */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onAddChild(id)
          }}
          className="grid h-5 w-5 shrink-0 place-items-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
          title="添加子页"
        >
          <Plus className="h-3.5 w-3.5" />
          <span className="sr-only">添加子页</span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              className="grid h-5 w-5 shrink-0 place-items-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
              <span className="sr-only">操作</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onClick={() => onAddChild(id)}>
              <Plus className="mr-2 h-4 w-4" />
              添加子页
            </DropdownMenuItem>
            {note.parentId !== null && (
              <DropdownMenuItem onClick={() => onMoveRoot(id)}>
                <CornerUpLeft className="mr-2 h-4 w-4" />
                移到根
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => onDelete(note)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {isOpen &&
        children.map((child) => (
          <PageTreeRow
            key={child.note.id}
            node={child}
            depth={depth + 1}
            selectedId={selectedId}
            expanded={expanded}
            dragId={dragId}
            dropHint={dropHint}
            onSelect={onSelect}
            onToggle={onToggle}
            onAddChild={onAddChild}
            onDelete={onDelete}
            onMoveRoot={onMoveRoot}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onHint={onHint}
            onCommitDrop={onCommitDrop}
            isUnder={isUnder}
          />
        ))}
    </div>
  )
}
