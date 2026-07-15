"use client"

import * as React from "react"
import {
  ChevronRight,
  File,
  FileAudio,
  FileCode,
  Folder,
  Link2,
  MessageSquare,
  Rss,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  fileRefKey,
  sameFileRef,
  type DirectoryEntry,
  type FileRef,
  type IdeallFile,
} from "@protocol/file-system"
import { readFileDirectory, statFile, watchFile } from "@/filesystem/registry"
import type { IdeallPath } from "@/filesystem/path"
import { resourceRefForFile } from "@/filesystem/resource-file-system"
import { openTarget } from "../store"
import { onTreeArrowNav, focusTreeSibling } from "./tree-keynav"
import { readAllDirectoryEntries } from "./directory-pagination"
import { fileCanExpand } from "./file-tree-expansion"
import { navigationEntryPath } from "./navigation-tree-path"

type LoadedEntry = { entry: DirectoryEntry; file: IdeallFile | null }

function fileIcon(file: IdeallFile | null) {
  if (!file) return File
  if (file.kind === "directory") return Folder
  if (
    file.mediaType === "application/vnd.ideall.bookmark+json" ||
    file.mediaType === "text/uri-list"
  ) {
    return Link2
  }
  if (file.mediaType === "application/vnd.ideall.feed+json") return Rss
  if (file.mediaType === "application/vnd.ideall.thread+json") return MessageSquare
  if (file.mediaType.startsWith("audio/")) return FileAudio
  if (file.mediaType.startsWith("text/") || file.mediaType.includes("json")) return FileCode
  return File
}

export function FileSystemTreeChildren({
  directory,
  depth,
  activeRef,
  rootId,
  expanded,
  onSetExpanded,
  refreshKey,
  navigationBasePath,
  onOpen,
}: {
  directory: FileRef
  depth: number
  activeRef: FileRef | null
  rootId: string
  expanded: Set<string>
  onSetExpanded: (ref: FileRef, expanded: boolean) => void
  refreshKey: string
  navigationBasePath?: IdeallPath
  onOpen?: (file: IdeallFile, expandable: boolean) => void
}) {
  const [items, setItems] = React.useState<LoadedEntry[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState(false)
  const [revision, setRevision] = React.useState(0)
  const { fileSystemId, fileId } = directory

  React.useEffect(() => {
    let alive = true
    setLoading(true)
    setError(false)
    const directoryRef = { fileSystemId, fileId }
    readAllDirectoryEntries((options) =>
      readFileDirectory(
        directoryRef,
        { actor: "ui", permissions: [], intent: "directory" },
        options,
      ),
    )
      .then(async (directoryEntries) => {
        const visibleEntries = directoryEntries.filter(
          (entry) => entry.properties?.navigationHidden !== true,
        )
        const loaded = await Promise.all(
          visibleEntries.map(async (entry) => ({
            entry,
            file:
              entry.file && sameFileRef(entry.file.ref, entry.target)
                ? entry.file
                : await statFile(entry.target, {
                    actor: "ui",
                    permissions: [],
                    intent: "metadata",
                  }).catch(() => null),
          })),
        )
        if (alive) setItems(loaded)
      })
      .catch(() => {
        if (alive) setError(true)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [fileId, fileSystemId, refreshKey, revision])

  React.useEffect(() => {
    try {
      return watchFile(
        { fileSystemId, fileId },
        { actor: "ui", permissions: [], intent: "watch" },
        () => setRevision((value) => value + 1),
      )?.dispose
    } catch {
      return undefined
    }
  }, [fileId, fileSystemId])

  if (loading) return <div className="mx-2 my-1 h-7 animate-pulse rounded bg-muted/50" />
  if (error) return <p className="px-3 py-2 text-xs text-muted-foreground">文件系统暂不可用</p>
  if (items.length === 0) return <p className="px-3 py-2 text-xs text-muted-foreground">暂无文件</p>

  return items.map(({ entry, file }) => (
    <FileTreeRow
      key={entry.entryId}
      entry={entry}
      file={file}
      depth={depth}
      activeRef={activeRef}
      rootId={rootId}
      expanded={expanded}
      onSetExpanded={onSetExpanded}
      refreshKey={`${refreshKey}:${revision}`}
      navigationBasePath={navigationBasePath}
      onOpen={onOpen}
    />
  ))
}

function FileTreeRow({
  entry,
  file,
  depth,
  activeRef,
  rootId,
  expanded,
  onSetExpanded,
  refreshKey,
  navigationBasePath,
  onOpen,
}: {
  entry: DirectoryEntry
  file: IdeallFile | null
  depth: number
  activeRef: FileRef | null
  rootId: string
  expanded: Set<string>
  onSetExpanded: (ref: FileRef, expanded: boolean) => void
  refreshKey: string
  navigationBasePath?: IdeallPath
  onOpen?: (file: IdeallFile, expandable: boolean) => void
}) {
  const Icon = fileIcon(file)
  const expandable = fileCanExpand(file)
  const open = expandable ? expanded.has(fileRefKey(file.ref)) : false
  const active = Boolean(file && activeRef && sameFileRef(file.ref, activeRef))
  const badge = file?.properties?.badge
  const navigationPath = navigationEntryPath(navigationBasePath, entry.pathName)

  const openFile = (transient: boolean) => {
    if (!file) return
    if (expandable) onSetExpanded(file.ref, true)
    const resource = resourceRefForFile(file.ref)
    const preferredEngine =
      typeof entry.properties?.preferredEngine === "string"
        ? entry.properties.preferredEngine
        : resource?.scheme === "node" && resource.kind === "note"
          ? "ideall.note"
          : undefined
    openTarget(
      {
        type: "file",
        ref: file.ref,
        file,
        engineId: preferredEngine,
        title: entry.name,
        transient,
        rootId,
        ...(navigationPath ? { navigationPath } : {}),
      },
      "user",
    )
    onOpen?.(file, expandable)
  }

  return (
    <div>
      <div
        role="treeitem"
        tabIndex={-1}
        aria-level={depth + 1}
        aria-selected={active || undefined}
        aria-expanded={expandable ? open : undefined}
        onClick={() => openFile(true)}
        onDoubleClick={() => openFile(false)}
        onKeyDown={(event) => {
          if (onTreeArrowNav(event)) return
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            openFile(false)
          } else if (event.key === "ArrowRight") {
            if (file && expandable && !open) {
              event.preventDefault()
              onSetExpanded(file.ref, true)
            } else if (focusTreeSibling(event.currentTarget, 1)) event.preventDefault()
          } else if (event.key === "ArrowLeft") {
            if (file && expandable && open) {
              event.preventDefault()
              onSetExpanded(file.ref, false)
            } else if (focusTreeSibling(event.currentTarget, -1)) event.preventDefault()
          }
        }}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        className={cn(
          "group flex cursor-pointer items-center gap-1 rounded-shell py-1.5 pr-1 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          active
            ? "bg-primary/10 font-medium text-primary"
            : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
          !file && "cursor-default opacity-50",
        )}
      >
        <span
          aria-hidden
          onClick={(event) => {
            event.stopPropagation()
            if (file && expandable) onSetExpanded(file.ref, !open)
          }}
          className={cn(
            "grid h-5 w-5 shrink-0 place-items-center rounded transition-transform hover:bg-accent",
            !expandable && "invisible",
            open && "rotate-90",
          )}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </span>
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
        {(typeof badge === "string" || typeof badge === "number") && (
          <span className="min-w-5 rounded-full bg-muted px-1.5 text-center text-[10px] tabular-nums text-muted-foreground">
            {badge}
          </span>
        )}
      </div>
      {file && expandable && open && (
        <FileSystemTreeChildren
          directory={file.ref}
          depth={depth + 1}
          activeRef={activeRef}
          rootId={rootId}
          expanded={expanded}
          onSetExpanded={onSetExpanded}
          refreshKey={refreshKey}
          navigationBasePath={navigationPath}
          onOpen={onOpen}
        />
      )}
    </div>
  )
}
