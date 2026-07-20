"use client"

import * as React from "react"
import { File, Folder, RefreshCw } from "lucide-react"
import { sameFileRef, type IdeallFile } from "@protocol/file-system"
import { readFileDirectory, watchFile } from "@/filesystem/registry"
import {
  projectDirectoryEntryMetadata,
  resolveDirectoryEntryMetadata,
  type DirectoryEntryMetadata,
} from "@/filesystem/directory-metadata"
import { statFileCached } from "@/filesystem/metadata-cache"
import type { FileSystemWatchEvent } from "@/filesystem/types"
import { useIncrementalList } from "@/lib/use-incremental-list"
import { cn } from "@/lib/utils"
import { Button } from "@/ui/button"
import {
  DirectoryWatchRequestGate,
  directoryWatchEntryKey,
  planDirectoryWatchEvent,
} from "../directory-watch-plan"
import { openTarget, useActiveRootId } from "../store"
import { useTabActive } from "../tab-active-context"
import { DIRECTORY_PAGE_SIZE } from "../tree/directory-pagination"

type LoadedEntry = DirectoryEntryMetadata
type LoadedPage = { entries: LoadedEntry[]; nextCursor?: string }

function replaceKnownVersions(
  versions: Map<string, string>,
  entries: readonly LoadedEntry[],
): void {
  versions.clear()
  for (const item of entries) {
    if (item.file?.version === undefined) continue
    versions.set(directoryWatchEntryKey(item.entry.entryId, item.entry.target), item.file.version)
  }
}

export default function FileDirectoryEngine({ file }: { file: IdeallFile }) {
  const active = useTabActive()
  const activeRootId = useActiveRootId()
  const [entries, setEntries] = React.useState<LoadedEntry[]>([])
  const [loading, setLoading] = React.useState(true)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [nextCursor, setNextCursor] = React.useState<string | undefined>()
  const [error, setError] = React.useState<string | null>(null)
  const [revision, setRevision] = React.useState(0)
  const loadEpoch = React.useRef(0)
  const mountedRef = React.useRef(false)
  const entriesRef = React.useRef<LoadedEntry[]>([])
  const nextCursorRef = React.useRef<string | undefined>(undefined)
  const watchReadyRef = React.useRef(false)
  const knownVersionsRef = React.useRef(new Map<string, string>())
  const watchRequestsRef = React.useRef(new DirectoryWatchRequestGate())
  const { fileSystemId, fileId } = file.ref

  React.useEffect(() => {
    const watchRequests = watchRequestsRef.current
    mountedRef.current = true
    watchRequests.activate()
    return () => {
      mountedRef.current = false
      watchReadyRef.current = false
      watchRequests.dispose()
    }
  }, [])

  const readPage = React.useCallback(
    async (cursor?: string, onProgress?: (page: LoadedPage) => void): Promise<LoadedPage> => {
      const directoryRef = { fileSystemId, fileId }
      const page = await readFileDirectory(
        directoryRef,
        { actor: "ui", permissions: [], intent: "directory" },
        { limit: DIRECTORY_PAGE_SIZE, ...(cursor === undefined ? {} : { cursor }) },
      )
      if (cursor !== undefined && page.nextCursor === cursor) {
        throw new Error(`Directory pagination cursor loop detected at ${JSON.stringify(cursor)}`)
      }
      // 与侧栏一致：navigationHidden 仅保留路由/兼容身份，不进浏览 UI。
      // 「文件」目录下的 panel:notes 管理面板即属此类，否则会多出一条同名记录。
      const visibleEntries = page.entries.filter(
        (entry) => entry.properties?.navigationHidden !== true,
      )
      const projected = projectDirectoryEntryMetadata(visibleEntries)
      onProgress?.({ entries: projected, nextCursor: page.nextCursor })
      const loaded = await resolveDirectoryEntryMetadata(
        projected,
        { actor: "ui", permissions: [], intent: "metadata" },
        (entries) => onProgress?.({ entries: [...entries], nextCursor: page.nextCursor }),
      )
      return { entries: loaded, nextCursor: page.nextCursor }
    },
    [fileId, fileSystemId],
  )

  React.useEffect(() => {
    if (!active) return
    const epoch = ++loadEpoch.current
    const watchRequests = watchRequestsRef.current
    let loaded = false
    watchReadyRef.current = false
    watchRequests.reset()
    entriesRef.current = []
    nextCursorRef.current = undefined
    knownVersionsRef.current.clear()
    setLoading(true)
    setLoadingMore(false)
    setEntries([])
    setNextCursor(undefined)
    setError(null)
    const commit = (page: LoadedPage) => {
      if (loadEpoch.current !== epoch) return
      loaded = true
      entriesRef.current = page.entries
      nextCursorRef.current = page.nextCursor
      replaceKnownVersions(knownVersionsRef.current, page.entries)
      setEntries(page.entries)
      setNextCursor(page.nextCursor)
      setLoading(false)
    }
    void readPage(undefined, commit)
      .then((page) => {
        if (loadEpoch.current !== epoch) return
        commit(page)
      })
      .catch((reason) => {
        if (loadEpoch.current === epoch) {
          setError(reason instanceof Error ? reason.message : String(reason))
        }
      })
      .finally(() => {
        if (loadEpoch.current === epoch) {
          watchReadyRef.current = loaded
          setLoading(false)
        }
      })
    return () => {
      if (loadEpoch.current === epoch) {
        loadEpoch.current += 1
        watchReadyRef.current = false
        watchRequests.reset()
      }
    }
  }, [active, readPage, revision])

  const loadMore = async () => {
    const cursor = nextCursor
    if (cursor === undefined || loadingMore) return
    const epoch = loadEpoch.current
    watchReadyRef.current = false
    setLoadingMore(true)
    setError(null)
    try {
      const base = entriesRef.current
      const mergePage = (page: LoadedPage) => {
        if (loadEpoch.current !== epoch) return
        const seen = new Set(base.map((item) => item.entry.entryId))
        const added = page.entries.filter((item) => {
          if (seen.has(item.entry.entryId)) return false
          seen.add(item.entry.entryId)
          return true
        })
        const nextEntries = [...base, ...added]
        entriesRef.current = nextEntries
        nextCursorRef.current = page.nextCursor
        replaceKnownVersions(knownVersionsRef.current, nextEntries)
        setEntries(nextEntries)
        setNextCursor(page.nextCursor)
      }
      const page = await readPage(cursor, mergePage)
      if (loadEpoch.current !== epoch) return
      mergePage(page)
    } catch (reason) {
      if (loadEpoch.current === epoch) {
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    } finally {
      if (loadEpoch.current === epoch) {
        watchReadyRef.current = true
        setLoadingMore(false)
      }
    }
  }

  const requestFullRefresh = React.useCallback(() => {
    if (!mountedRef.current) return
    // Invalidate both directory/page loads and per-entry stat requests immediately; waiting for
    // the next render would leave a window where an older async result could commit.
    loadEpoch.current += 1
    watchReadyRef.current = false
    watchRequestsRef.current.reset()
    setRevision((value) => value + 1)
  }, [])

  const handleWatchEvent = React.useCallback(
    (event: FileSystemWatchEvent) => {
      if (!mountedRef.current) return
      const effectiveVersions = new Map(knownVersionsRef.current)
      for (const [key, version] of watchRequestsRef.current.pendingVersions()) {
        effectiveVersions.set(key, version)
      }
      const plan = planDirectoryWatchEvent({
        directory: { fileSystemId, fileId },
        loaded: entriesRef.current,
        event,
        paginationRisk: !watchReadyRef.current || nextCursorRef.current !== undefined,
        knownVersions: effectiveVersions,
      })
      if (plan.type === "ignore") return
      if (plan.type === "refresh") {
        requestFullRefresh()
        return
      }

      for (const operation of plan.operations) {
        if (operation.type === "remove") {
          watchRequestsRef.current.invalidate(operation.key)
          knownVersionsRef.current.delete(operation.key)
          const current = entriesRef.current
          const index = current.findIndex(
            (item) =>
              item.entry.entryId === operation.entryId &&
              sameFileRef(item.entry.target, operation.target),
          )
          if (index < 0) {
            requestFullRefresh()
            return
          }
          const next = [...current.slice(0, index), ...current.slice(index + 1)]
          entriesRef.current = next
          setEntries(next)
          continue
        }

        const token = watchRequestsRef.current.start(operation.key, operation.version)
        if (!token) return
        void statFileCached(
          operation.target,
          { actor: "ui", permissions: [], intent: "metadata" },
          { refresh: true },
        )
          .then((nextFile) => {
            if (!mountedRef.current || !watchRequestsRef.current.accepts(token)) return
            watchRequestsRef.current.invalidate(operation.key)
            if (!nextFile || !sameFileRef(nextFile.ref, operation.target)) {
              requestFullRefresh()
              return
            }
            const current = entriesRef.current
            const index = current.findIndex(
              (item) =>
                item.entry.entryId === operation.entryId &&
                sameFileRef(item.entry.target, operation.target),
            )
            if (index < 0) {
              requestFullRefresh()
              return
            }
            const next = [...current]
            const previous = current[index] as LoadedEntry
            next[index] = {
              entry: {
                ...previous.entry,
                ...(previous.entry.kind === "child" ? { name: nextFile.name } : {}),
                file: nextFile,
              },
              file: nextFile,
            }
            entriesRef.current = next
            const version = nextFile.version ?? operation.version
            if (version === undefined) knownVersionsRef.current.delete(operation.key)
            else knownVersionsRef.current.set(operation.key, version)
            setEntries(next)
          })
          .catch(() => {
            if (!mountedRef.current || !watchRequestsRef.current.accepts(token)) return
            watchRequestsRef.current.invalidate(operation.key)
            requestFullRefresh()
          })
      }
    },
    [fileId, fileSystemId, requestFullRefresh],
  )

  React.useEffect(() => {
    if (!active) return
    try {
      return watchFile(
        { fileSystemId, fileId },
        { actor: "ui", permissions: [], intent: "watch" },
        handleWatchEvent,
      )?.dispose
    } catch {
      return undefined
    }
  }, [active, fileId, fileSystemId, handleWatchEvent])

  const { visible, hasMore, sentinelRef, shown, total } = useIncrementalList(entries, {
    enabled: active,
    pageSize: 80,
    resetKey: `${fileSystemId}\u0000${fileId}\u0000${revision}`,
  })

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-4 overflow-y-auto p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold">{file.name}</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {file.source.label ?? file.source.id}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={requestFullRefresh}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          刷新
        </Button>
      </div>
      {error && entries.length === 0 ? (
        <div className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : loading ? (
        <div className="h-32 animate-pulse rounded-lg bg-muted/50" />
      ) : entries.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          目录为空
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          {visible.map(({ entry, file: child }) => {
            const Icon = child?.kind === "directory" ? Folder : File
            const preferredEngine =
              typeof entry.properties?.preferredEngine === "string"
                ? entry.properties.preferredEngine
                : undefined
            const openChild = (transient: boolean) => {
              if (!child) return
              openTarget({
                type: "file",
                ref: child.ref,
                file: child,
                engineId: preferredEngine,
                transient,
                rootId: activeRootId,
              })
            }
            return (
              <button
                key={entry.entryId}
                type="button"
                disabled={!child}
                onClick={() => openChild(true)}
                onDoubleClick={() => openChild(false)}
                className={cn(
                  "flex w-full items-center gap-3 border-b px-3 py-2.5 text-left text-sm last:border-b-0 hover:bg-accent/50 disabled:opacity-50",
                  total > 80 && "[contain-intrinsic-size:41px] [content-visibility:auto]",
                )}
              >
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                <span className="max-w-48 truncate text-xs text-muted-foreground">
                  {child?.mediaType ?? "不可用"}
                </span>
              </button>
            )
          })}
          {hasMore ? (
            <div
              ref={sentinelRef}
              className="border-t p-2 text-center text-xs text-muted-foreground"
            >
              已显示 {shown} / {total}
            </div>
          ) : null}
          {error ? <div className="border-t p-3 text-sm text-destructive">{error}</div> : null}
          {!hasMore && nextCursor !== undefined ? (
            <div className="border-t p-2 text-center">
              <Button
                variant="ghost"
                size="sm"
                disabled={loadingMore}
                onClick={() => void loadMore()}
              >
                {loadingMore ? "加载中…" : "加载更多"}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
