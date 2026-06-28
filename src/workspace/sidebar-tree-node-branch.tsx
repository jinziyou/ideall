"use client"

import * as React from "react"
import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Tree } from "@/files/notes-tree-util"
import type { NodeSummary } from "@/files/stores/nodes-store"
import type { NodeKind } from "@protocol/node"
import { iconForNodeKind } from "./sidebar-tree-data"
import { getBookmark } from "@/files/stores/bookmarks-store"
import { browserNavigate, browserShow, isTauri } from "@/lib/tauri"
import { safeHref } from "@/lib/safe-url"
import { openNodeTab, getTabs } from "./store"
import { parseNodeParams } from "./node-tab"
import type { ModuleId } from "./types"

type DropZone = "before" | "after" | "inside"

function isNodeActive(activeId: string | null, kind: NodeKind, id: string): boolean {
  if (!activeId) return false
  const t = getTabs().find((x) => x.id === activeId)
  if (!t || t.kind !== "node") return false
  const ref = parseNodeParams(t.params)
  return ref?.kind === kind && ref.id === id
}

async function openBookmarkInBrowser(id: string) {
  const bm = await getBookmark(id)
  if (!bm) return
  const href = safeHref(bm.url)
  if (!href) return
  if (!isTauri()) {
    window.open(href, "_blank", "noopener,noreferrer")
    return
  }
  await browserNavigate(href)
  await browserShow()
}

export function NodeTreeBranch({
  item,
  children,
  depth,
  expanded,
  activeId,
  activeModule,
  onToggle,
  draggable = false,
  dragId = null,
  dropHint = null,
  onDragStart,
  onDragEnd,
  onHint,
  onCommitDrop,
  isUnder,
  zoneFromEvent,
}: {
  item: NodeSummary
  children: Tree<NodeSummary>[]
  depth: number
  expanded: Set<string>
  activeId: string | null
  activeModule: ModuleId
  onToggle: (id: string) => void
  draggable?: boolean
  dragId?: string | null
  dropHint?: { id: string; zone: DropZone } | null
  onDragStart?: (id: string) => void
  onDragEnd?: () => void
  onHint?: (h: { id: string; zone: DropZone } | null) => void
  onCommitDrop?: (targetId: string, zone: DropZone) => void
  isUnder?: (nodeId: string, ancestorId: string) => boolean
  zoneFromEvent?: (e: React.DragEvent, targetKind: NodeKind) => DropZone
}) {
  const id = `node:${item.kind}:${item.id}`
  const isOpen = expanded.has(id)
  const Icon = iconForNodeKind(item.kind)
  const active = isNodeActive(activeId, item.kind, item.id)
  const hasKids = children.length > 0
  const inBrowser = activeModule === "browser"

  const invalidTarget =
    draggable &&
    dragId != null &&
    isUnder != null &&
    (dragId === item.id || isUnder(item.id, dragId))
  const hint = dropHint?.id === item.id ? dropHint.zone : null

  const handleNodeClick = () => {
    if (inBrowser && item.kind === "bookmark") {
      void openBookmarkInBrowser(item.id)
      return
    }
    if (inBrowser && item.kind === "folder") {
      if (hasKids) onToggle(id)
      return
    }
    openNodeTab({ kind: item.kind, id: item.id }, item.title || "无标题")
  }

  const rowProps =
    draggable && onDragStart && onDragEnd && onHint && onCommitDrop && zoneFromEvent
      ? {
          draggable: true as const,
          onDragStart: (e: React.DragEvent) => {
            e.stopPropagation()
            e.dataTransfer.effectAllowed = "move"
            onDragStart(item.id)
          },
          onDragEnd: onDragEnd,
          onDragOver: (e: React.DragEvent) => {
            if (!dragId || invalidTarget) return
            e.preventDefault()
            e.stopPropagation()
            onHint({ id: item.id, zone: zoneFromEvent(e, item.kind) })
          },
          onDragLeave: (e: React.DragEvent) => {
            e.stopPropagation()
            if (dropHint?.id === item.id) onHint(null)
          },
          onDrop: (e: React.DragEvent) => {
            if (!dragId) return
            e.preventDefault()
            e.stopPropagation()
            if (invalidTarget) return
            onCommitDrop(item.id, zoneFromEvent(e, item.kind))
          },
        }
      : {}

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={handleNodeClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            handleNodeClick()
          }
        }}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        aria-current={active ? "page" : undefined}
        aria-expanded={hasKids ? isOpen : undefined}
        className={cn(
          "group relative flex cursor-pointer items-center gap-1 rounded-shell py-1.5 pr-1 text-sm transition-colors",
          active
            ? "bg-primary/10 font-medium text-primary"
            : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
          hint === "inside" && "bg-primary/15 ring-1 ring-inset ring-primary/40",
        )}
        {...rowProps}
      >
        {hint === "before" && (
          <span className="pointer-events-none absolute inset-x-1 top-0 h-0.5 rounded bg-primary" />
        )}
        {hint === "after" && (
          <span className="pointer-events-none absolute inset-x-1 bottom-0 h-0.5 rounded bg-primary" />
        )}

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
            activeModule={activeModule}
            onToggle={onToggle}
            draggable={draggable}
            dragId={dragId}
            dropHint={dropHint}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onHint={onHint}
            onCommitDrop={onCommitDrop}
            isUnder={isUnder}
            zoneFromEvent={zoneFromEvent}
          />
        ))}
    </div>
  )
}
