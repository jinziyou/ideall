"use client"

import * as React from "react"
import { ChevronRight, ClipboardCopy, Download, MoreHorizontal, Pencil, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Tree } from "@/files/notes-tree-util"
import type { NodeSummary } from "@/files/stores/nodes-store"
import type { NodeKind } from "@protocol/node"
import { iconForNodeKind } from "./sidebar-tree-data"
import { onTreeArrowNav, focusTreeSibling } from "./tree-keynav"
import { getBookmark } from "@/files/stores/bookmarks-store"
import { navigateExternal } from "../browser-open"
import { openNodeTab, getTabs } from "../store"
import { parseNodeParams } from "../node-tab"
import type { ModuleId } from "../types"
import { FileTypeIcon } from "@/shared/file-type-icon"
import { useFileActions } from "../use-file-actions"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu"
import { ConfirmDialog, TextPromptDialog } from "@/shared/prompt-dialog"

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
  // 已在「浏览器」模块内 → 仅导航现有视图, 不开新标签。
  if (bm) await navigateExternal(bm.url, { newTab: false })
}

export function NodeTreeBranch({
  item,
  childNodes,
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
  childNodes: Tree<NodeSummary>[]
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
  const hasKids = childNodes.length > 0
  const inBrowser = activeModule === "browser"
  const [fileMenuOpen, setFileMenuOpen] = React.useState(false)
  const [renameOpen, setRenameOpen] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const fileActions = useFileActions()

  const invalidTarget =
    draggable &&
    dragId != null &&
    isUnder != null &&
    (dragId === item.id || isUnder(item.id, dragId))
  const hint = dropHint?.id === item.id ? dropHint.zone : null

  // 与 TreeRow 一致的 VS Code 式语义: 单击 = 预览 (transient, 复用单一预览槽);
  // 双击 / 键盘 Enter = 固定为常驻。浏览器内书签/文件夹是导航/展开, 不开标签 (无瞬态概念)。
  const openNode = (transient: boolean) => {
    if (inBrowser && item.kind === "bookmark") {
      void openBookmarkInBrowser(item.id)
      return
    }
    if (inBrowser && item.kind === "folder") {
      if (hasKids) onToggle(id)
      return
    }
    openNodeTab({ kind: item.kind, id: item.id }, item.title || "无标题", "user", { transient })
  }

  const handleNodeClick = () => openNode(true)
  const handleNodeDoubleClick = () => openNode(false)

  async function handleFileRename(name: string) {
    if (item.kind !== "file" || name === item.title) return
    await fileActions.rename(item.id, name)
  }

  async function handleFileDownload() {
    if (item.kind !== "file") return
    await fileActions.download(item.id)
  }

  async function handleFileDelete() {
    if (item.kind !== "file") return
    await fileActions.remove({ id: item.id, name: item.title || "无标题", closeTab: true })
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
        role="treeitem"
        tabIndex={-1}
        aria-level={depth + 1}
        aria-selected={active || undefined}
        aria-expanded={hasKids ? isOpen : undefined}
        onClick={handleNodeClick}
        onDoubleClick={handleNodeDoubleClick}
        onContextMenu={(e) => {
          if (item.kind !== "file") return
          e.preventDefault()
          e.stopPropagation()
          setFileMenuOpen(true)
        }}
        onKeyDown={(e) => {
          if (onTreeArrowNav(e)) return
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            openNode(false)
          } else if (e.key === "ArrowRight") {
            if (hasKids && !isOpen) {
              e.preventDefault()
              onToggle(id)
            } else if (focusTreeSibling(e.currentTarget, 1)) {
              e.preventDefault()
            }
          } else if (e.key === "ArrowLeft") {
            if (hasKids && isOpen) {
              e.preventDefault()
              onToggle(id)
            } else if (focusTreeSibling(e.currentTarget, -1)) {
              e.preventDefault()
            }
          }
        }}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        className={cn(
          "group relative flex cursor-pointer items-center gap-1 rounded-shell py-1.5 pr-1 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
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

        {/* 展开箭头: 展示性 (aria-hidden + 非按钮); 键盘走行的 ←/→, 鼠标点箭头仍可。 */}
        <span
          aria-hidden="true"
          onClick={(e) => {
            e.stopPropagation()
            if (hasKids) onToggle(id)
          }}
          className={cn(
            "grid h-5 w-5 shrink-0 cursor-pointer place-items-center rounded text-muted-foreground transition-transform hover:bg-accent",
            !hasKids && "invisible",
            isOpen && "rotate-90",
          )}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </span>
        {item.kind === "file" ? (
          <FileTypeIcon name={item.title || ""} type={item.mime} className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <Icon className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate text-left">{item.title || "无标题"}</span>
        {item.kind === "file" && (
          <DropdownMenu open={fileMenuOpen} onOpenChange={setFileMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`文件操作：${item.title || "无标题"}`}
                onClick={(e) => e.stopPropagation()}
                className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-shell text-muted-foreground opacity-0 outline-none transition-[opacity,background-color,color] hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring group-hover:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem onClick={() => setRenameOpen(true)}>
                <Pencil className="mr-2 h-4 w-4" />
                重命名
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void handleFileDownload()}>
                <Download className="mr-2 h-4 w-4" />
                下载
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void fileActions.copyName(item.title || "无标题")}>
                <ClipboardCopy className="mr-2 h-4 w-4" />
                复制文件名
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void fileActions.copyRef(item.id)}>
                <ClipboardCopy className="mr-2 h-4 w-4" />
                复制引用
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                删除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {item.kind === "file" && (
        <>
          <TextPromptDialog
            open={renameOpen}
            onOpenChange={setRenameOpen}
            title="重命名文件"
            label="名称"
            defaultValue={item.title || ""}
            onSubmit={(value) => void handleFileRename(value)}
          />
          <ConfirmDialog
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            title={`删除「${item.title || "无标题"}」?`}
            description="如果该文件已打开并有未保存草稿，删除会同时关闭标签并丢弃草稿。"
            confirmLabel="删除"
            destructive
            onConfirm={() => void handleFileDelete()}
          />
        </>
      )}
      {isOpen &&
        childNodes.map((child) => (
          <NodeTreeBranch
            key={child.item.id}
            item={child.item}
            childNodes={child.children}
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
