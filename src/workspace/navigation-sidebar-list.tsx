"use client"

import { ChevronRight } from "lucide-react"
import { fileRefKey, sameFileRef } from "@protocol/file-system"
import { cn } from "@/lib/utils"
import { fileEngineTargetForTab } from "./file-tab"
import { navigationSection, type NavigationSectionId } from "./navigation-sections"
import { openTarget, useActiveId, useActiveRootId, useTabs } from "./store"
import { FileSystemTreeChildren } from "./tree/file-system-sidebar-tree"
import { useFileTreeExpansion } from "./tree/file-tree-expansion"
import { focusTreeSibling, forwardTreeFocus, onTreeArrowNav } from "./tree/tree-keynav"

export default function NavigationSidebarList({
  sectionId,
  onNavigate,
}: {
  sectionId?: NavigationSectionId
  onNavigate?: () => void
}) {
  const activeRootId = useActiveRootId()
  const activeId = useActiveId()
  const tabs = useTabs()
  const section = navigationSection(sectionId ?? activeRootId)
  const activeFile = fileEngineTargetForTab(tabs.find((tab) => tab.id === activeId))?.ref ?? null
  const { expanded, setExpanded } = useFileTreeExpansion()

  return (
    <nav
      role="tree"
      aria-label={`${section.label}导航`}
      tabIndex={0}
      onFocus={forwardTreeFocus}
      className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2 outline-none"
    >
      {section.items.map((item) => {
        const Icon = item.icon
        const active = Boolean(activeFile && sameFileRef(activeFile, item.target.ref))
        const expandable = item.target.kind === "directory"
        const open = expandable && expanded.has(fileRefKey(item.target.ref))

        const openItem = (transient: boolean) => {
          if (expandable) setExpanded(item.target.ref, true)
          openTarget(
            {
              type: "file",
              ref: item.target.ref,
              engineId: item.target.engineId,
              title: item.label,
              rootId: section.id,
              transient,
            },
            "user",
          )
          if (!expandable) onNavigate?.()
        }

        return (
          <div key={item.id}>
            <div
              role="treeitem"
              tabIndex={-1}
              aria-level={1}
              aria-selected={active || undefined}
              aria-expanded={expandable ? open : undefined}
              onClick={() => openItem(true)}
              onDoubleClick={() => openItem(false)}
              onKeyDown={(event) => {
                if (onTreeArrowNav(event)) return
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault()
                  openItem(false)
                } else if (event.key === "ArrowRight") {
                  if (expandable && !open) {
                    event.preventDefault()
                    setExpanded(item.target.ref, true)
                  } else if (focusTreeSibling(event.currentTarget, 1)) event.preventDefault()
                } else if (event.key === "ArrowLeft") {
                  if (expandable && open) {
                    event.preventDefault()
                    setExpanded(item.target.ref, false)
                  } else if (focusTreeSibling(event.currentTarget, -1)) event.preventDefault()
                }
              }}
              className={cn(
                "group flex cursor-pointer items-center gap-1 rounded-shell py-1.5 pr-1 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                active
                  ? "bg-primary/10 font-medium text-primary"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              <span
                aria-hidden
                onClick={(event) => {
                  event.stopPropagation()
                  if (expandable) setExpanded(item.target.ref, !open)
                }}
                className={cn(
                  "grid h-5 w-5 shrink-0 place-items-center rounded transition-transform hover:bg-accent",
                  !expandable && "invisible",
                  open && "rotate-90",
                )}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </span>
              <Icon className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
            </div>
            {expandable && open && (
              <FileSystemTreeChildren
                directory={item.target.ref}
                depth={1}
                activeRef={activeFile}
                rootId={section.id}
                expanded={expanded}
                onSetExpanded={setExpanded}
                refreshKey={`navigation:${section.id}:${item.id}`}
                onOpen={(_file, childExpandable) => {
                  if (!childExpandable) onNavigate?.()
                }}
              />
            )}
          </div>
        )
      })}
    </nav>
  )
}
