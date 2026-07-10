"use client"

import * as React from "react"
import { File, Folder, RefreshCw } from "lucide-react"
import type { DirectoryEntry, IdeallFile } from "@protocol/file-system"
import { readFileDirectory, statFile, watchFile } from "@/filesystem/registry"
import { Button } from "@/ui/button"
import { openTarget, useActiveRootId } from "../store"
import { readAllDirectoryEntries } from "../tree/directory-pagination"

type LoadedEntry = { entry: DirectoryEntry; file: IdeallFile | null }

export default function FileDirectoryEngine({ file }: { file: IdeallFile }) {
  const activeRootId = useActiveRootId()
  const [entries, setEntries] = React.useState<LoadedEntry[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [revision, setRevision] = React.useState(0)
  const { fileSystemId, fileId } = file.ref

  React.useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
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
        if (alive) setEntries(loaded)
      })
      .catch((reason) => {
        if (alive) setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [fileId, fileSystemId, revision])

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

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-4 overflow-y-auto p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold">{file.name}</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {file.source.label ?? file.source.id}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setRevision((value) => value + 1)}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          刷新
        </Button>
      </div>
      {error ? (
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
          {entries.map(({ entry, file: child }) => {
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
                className="flex w-full items-center gap-3 border-b px-3 py-2.5 text-left text-sm last:border-b-0 hover:bg-accent/50 disabled:opacity-50"
              >
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                <span className="max-w-48 truncate text-xs text-muted-foreground">
                  {child?.mediaType ?? "不可用"}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
