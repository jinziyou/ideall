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
import { getTabs, openTarget, useActiveId, useActiveRootId } from "../store"
import { coreFileRoot, fileRootRef, isCoreFileRootId } from "../file-roots"
import { fileEngineTargetForTab } from "../file-tab"
import { onTreeArrowNav, focusTreeSibling, forwardTreeFocus } from "./tree-keynav"
import { subscribeSidebarTreeRefresh } from "./sidebar-tree-bus"
import { readAllDirectoryEntries } from "./directory-pagination"

const EXPANDED_KEY = "ideall:file-system-tree:expanded"

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

function activeFileRef(activeId: string | null): FileRef | null {
  const tab = getTabs().find((item) => item.id === activeId)
  return fileEngineTargetForTab(tab)?.ref ?? null
}

export default function FileSystemSidebarTree() {
  const rootId = useActiveRootId()
  const directory = fileRootRef(rootId)
  const activeId = useActiveId()
  const [refreshToken, setRefreshToken] = React.useState(0)
  const [expanded, setExpanded] = React.useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set()
    try {
      const raw = window.localStorage.getItem(EXPANDED_KEY)
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
    } catch {
      return new Set()
    }
  })

  React.useEffect(() => {
    try {
      window.localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expanded]))
    } catch {
      /* storage unavailable */
    }
  }, [expanded])

  React.useEffect(
    () => subscribeSidebarTreeRefresh(() => setRefreshToken((value) => value + 1)),
    [],
  )

  const toggle = React.useCallback((ref: FileRef) => {
    const key = fileRefKey(ref)
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  return (
    <nav
      role="tree"
      aria-label={`${isCoreFileRootId(rootId) ? coreFileRoot(rootId).label : "挂载"}文件树`}
      tabIndex={0}
      onFocus={forwardTreeFocus}
      className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2 outline-none"
    >
      {directory ? (
        <DirectoryChildren
          directory={directory}
          depth={0}
          activeRef={activeFileRef(activeId)}
          rootId={rootId}
          expanded={expanded}
          onToggle={toggle}
          refreshToken={refreshToken}
        />
      ) : (
        <p className="px-3 py-2 text-xs text-muted-foreground">挂载已断开</p>
      )}
    </nav>
  )
}

function DirectoryChildren({
  directory,
  depth,
  activeRef,
  rootId,
  expanded,
  onToggle,
  refreshToken,
}: {
  directory: FileRef
  depth: number
  activeRef: FileRef | null
  rootId: string
  expanded: Set<string>
  onToggle: (ref: FileRef) => void
  refreshToken: number
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
        const loaded = await Promise.all(
          directoryEntries.map(async (entry) => ({
            entry,
            file: await statFile(entry.target, {
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
  }, [fileId, fileSystemId, refreshToken, revision])

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
      onToggle={onToggle}
      refreshToken={refreshToken}
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
  onToggle,
  refreshToken,
}: {
  entry: DirectoryEntry
  file: IdeallFile | null
  depth: number
  activeRef: FileRef | null
  rootId: string
  expanded: Set<string>
  onToggle: (ref: FileRef) => void
  refreshToken: number
}) {
  const Icon = fileIcon(file)
  const expandable = file?.kind === "directory"
  const open = expandable ? expanded.has(fileRefKey(file.ref)) : false
  const active = Boolean(file && activeRef && sameFileRef(file.ref, activeRef))
  const badge = file?.properties?.badge

  const openFile = (transient: boolean) => {
    if (!file) return
    const preferredEngine =
      typeof entry.properties?.preferredEngine === "string"
        ? entry.properties.preferredEngine
        : undefined
    openTarget(
      {
        type: "file",
        ref: file.ref,
        file,
        engineId: preferredEngine,
        transient,
        rootId,
      },
      "user",
    )
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
              onToggle(file.ref)
            } else if (focusTreeSibling(event.currentTarget, 1)) event.preventDefault()
          } else if (event.key === "ArrowLeft") {
            if (file && expandable && open) {
              event.preventDefault()
              onToggle(file.ref)
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
            if (file && expandable) onToggle(file.ref)
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
        <DirectoryChildren
          directory={file.ref}
          depth={depth + 1}
          activeRef={activeRef}
          rootId={rootId}
          expanded={expanded}
          onToggle={onToggle}
          refreshToken={refreshToken}
        />
      )}
    </div>
  )
}
