"use client"

// 侧栏 node 子树拖拽 —— 书签/收藏夹: before/after 同级重排, folder 上 inside = 归入收藏夹。
import * as React from "react"
import { toast } from "sonner"
import {
  buildParentOf,
  effectiveParentId,
  type InsertPos,
  type Tree,
} from "@/files/notes-tree-util"
import type { NodeKind } from "@protocol/node"
import { invokeResourceAction } from "@/vfs/registry"
import { nodeMoveActionInput, nodeResourceRef } from "@/vfs/node-actions"
import { refreshSidebarTree } from "./sidebar-tree-bus"
import type { ModuleId } from "../types"
import { NodeTreeBranch } from "./sidebar-tree-node-branch"
import type { NodeTreeItem } from "./node-tree-item"

type DropZone = "before" | "after" | "inside"

const DRAG_KINDS = new Set<NodeKind>(["bookmark", "folder"])

function zoneFromEvent(e: React.DragEvent, targetKind: NodeKind): DropZone {
  const r = e.currentTarget.getBoundingClientRect()
  const y = e.clientY - r.top
  if (targetKind === "bookmark") {
    return y < r.height * 0.5 ? "before" : "after"
  }
  if (y < r.height * 0.28) return "before"
  if (y > r.height * 0.72) return "after"
  return "inside"
}

export function DraggableNodeForest({
  forest,
  flatItems,
  sectionId,
  childKinds,
  depth,
  expanded,
  activeId,
  activeModule,
  onToggle,
  onLoadNodes,
}: {
  forest: Tree<NodeTreeItem>[]
  flatItems: NodeTreeItem[]
  sectionId: string
  childKinds: NodeKind[]
  depth: number
  expanded: Set<string>
  activeId: string | null
  activeModule: ModuleId
  onToggle: (id: string) => void
  onLoadNodes: (sectionId: string, kinds: NodeKind[]) => void
}) {
  const byId = React.useMemo(() => new Map(flatItems.map((n) => [n.id, n])), [flatItems])

  const info = React.useMemo(() => {
    const m = new Map<string, { parentId: string | null; ordered: NodeTreeItem[] }>()
    const parentOf = buildParentOf(flatItems)
    const childrenOf = new Map<string | null, NodeTreeItem[]>()
    for (const n of flatItems) {
      const ep = effectiveParentId(n.id, n.parentId, parentOf)
      const arr = childrenOf.get(ep) ?? []
      arr.push(n)
      childrenOf.set(ep, arr)
    }
    for (const n of flatItems) {
      const ep = effectiveParentId(n.id, n.parentId, parentOf)
      m.set(n.id, { parentId: ep, ordered: childrenOf.get(ep) ?? [] })
    }
    return m
  }, [flatItems])

  const [dragId, setDragId] = React.useState<string | null>(null)
  const [dropHint, setDropHint] = React.useState<{ id: string; zone: DropZone } | null>(null)

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

  const reload = React.useCallback(() => {
    onLoadNodes(sectionId, childKinds)
    refreshSidebarTree()
  }, [onLoadNodes, sectionId, childKinds])

  const runMove = React.useCallback(
    async (id: string, kind: NodeKind, newParentId: string | null, pos?: InsertPos) => {
      try {
        await invokeResourceAction(
          nodeResourceRef(kind, id),
          "move",
          nodeMoveActionInput(newParentId, pos?.afterSortKey),
          { actor: "ui", permissions: [], intent: "action" },
        )
        reload()
      } catch (e) {
        toast.error("移动失败", { description: String(e) })
      }
    },
    [reload],
  )

  const commitDrop = React.useCallback(
    (targetId: string, zone: DropZone) => {
      const id = dragId
      setDragId(null)
      setDropHint(null)
      if (!id || id === targetId || isUnder(targetId, id)) return
      const dragKind = byId.get(id)?.kind
      const target = byId.get(targetId)
      if (!dragKind || !DRAG_KINDS.has(dragKind) || !target) return
      const t = info.get(targetId)
      if (!t) return

      if (zone === "inside") {
        if (dragKind === "bookmark" && target.kind === "folder") {
          void runMove(id, dragKind, targetId, undefined)
          return
        }
        if (dragKind === "folder" && target.kind === "folder") {
          void runMove(id, dragKind, null, { afterSortKey: target.sortKey })
        }
        return
      }

      const sibs = t.ordered.filter((s) => s.id !== id)
      const targetMeta = t.ordered.find((s) => s.id === targetId)
      if (zone === "after") {
        const parentId = dragKind === "folder" ? null : t.parentId
        void runMove(id, dragKind, parentId, { afterSortKey: targetMeta?.sortKey })
      } else {
        const ti = sibs.findIndex((s) => s.id === targetId)
        const pos: InsertPos =
          ti <= 0 ? { afterSortKey: null } : { afterSortKey: sibs[ti - 1].sortKey }
        const parentId = dragKind === "folder" ? null : t.parentId
        void runMove(id, dragKind, parentId, pos)
      }
    },
    [dragId, byId, info, isUnder, runMove],
  )

  const dragKind = dragId ? byId.get(dragId)?.kind : null

  return (
    <div
      className="flex flex-col"
      onDragOver={(e) => {
        if (dragId) e.preventDefault()
      }}
      onDrop={(e) => {
        if (!dragId || !dragKind) return
        e.preventDefault()
        const id = dragId
        setDragId(null)
        setDropHint(null)
        void runMove(id, dragKind, null, undefined)
      }}
    >
      {forest.map(({ item, children }) => (
        <NodeTreeBranch
          key={item.id}
          item={item}
          childNodes={children}
          depth={depth}
          expanded={expanded}
          activeId={activeId}
          activeModule={activeModule}
          onToggle={onToggle}
          draggable={DRAG_KINDS.has(item.kind)}
          dragId={dragId}
          dropHint={dropHint}
          onDragStart={setDragId}
          onDragEnd={() => {
            setDragId(null)
            setDropHint(null)
          }}
          onHint={setDropHint}
          onCommitDrop={commitDrop}
          isUnder={isUnder}
          zoneFromEvent={zoneFromEvent}
        />
      ))}
    </div>
  )
}
