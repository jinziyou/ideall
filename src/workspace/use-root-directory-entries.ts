"use client"

import * as React from "react"
import type { DirectoryEntry } from "@protocol/file-system"
import { ideallRootFileSystem } from "@/filesystem/builtin"
import { readFileDirectory, watchFile } from "@/filesystem/registry"
import { isCoreFileRootId } from "./file-roots"

const ROOT_CONTEXT = { actor: "ui", permissions: [], intent: "directory" } as const
const WATCH_CONTEXT = { actor: "ui", permissions: [], intent: "watch" } as const

export function useRootDirectoryEntries(): DirectoryEntry[] {
  const [entries, setEntries] = React.useState<DirectoryEntry[]>([])

  React.useEffect(() => {
    let alive = true
    const root = ideallRootFileSystem.descriptor.root
    const load = () =>
      readFileDirectory(root, ROOT_CONTEXT)
        .then((page) => {
          if (alive) setEntries(page.entries)
        })
        .catch(() => {})
    void load()

    let dispose: (() => void) | undefined
    try {
      dispose = watchFile(root, WATCH_CONTEXT, () => void load())?.dispose
    } catch {
      /* The composition root may still be booting. */
    }
    return () => {
      alive = false
      dispose?.()
    }
  }, [])

  return React.useMemo(() => entries.filter((entry) => isCoreFileRootId(entry.entryId)), [entries])
}
