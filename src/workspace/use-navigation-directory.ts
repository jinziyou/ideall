"use client"

import * as React from "react"
import {
  sameFileRef,
  type DirectoryEntry,
  type FileRef,
  type IdeallFile,
} from "@protocol/file-system"
import {
  getFileSystemRevision,
  readFileDirectory,
  statFile,
  subscribeFileSystems,
  watchFile,
} from "@/filesystem/registry"
import { readAllDirectoryEntries } from "./tree/directory-pagination"

export type NavigationDirectoryItem = Readonly<{
  entry: DirectoryEntry
  file: IdeallFile | null
}>

export type NavigationDirectoryState = Readonly<{
  items: readonly NavigationDirectoryItem[]
  loading: boolean
  unavailable: boolean
}>

/** ActivityBar、桌面侧栏与移动抽屉共用的 FileSystem 目录读取边界。 */
export function useNavigationDirectory(directory: FileRef): NavigationDirectoryState {
  const registryRevision = React.useSyncExternalStore(
    subscribeFileSystems,
    getFileSystemRevision,
    getFileSystemRevision,
  )
  const [watchRevision, setWatchRevision] = React.useState(0)
  const [state, setState] = React.useState<NavigationDirectoryState>({
    items: [],
    loading: true,
    unavailable: false,
  })
  const { fileSystemId, fileId } = directory

  React.useEffect(() => {
    let active = true
    setState((current) => ({ ...current, loading: true, unavailable: false }))
    const ref = { fileSystemId, fileId }
    void readAllDirectoryEntries((options) =>
      readFileDirectory(ref, { actor: "ui", permissions: [], intent: "directory" }, options),
    )
      .then(async (entries) => {
        const visible = entries.filter((entry) => entry.properties?.navigationHidden !== true)
        const items = await Promise.all(
          visible.map(async (entry) => ({
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
        if (active) setState({ items, loading: false, unavailable: false })
      })
      .catch(() => {
        if (active) setState({ items: [], loading: false, unavailable: true })
      })
    return () => {
      active = false
    }
  }, [fileId, fileSystemId, registryRevision, watchRevision])

  React.useEffect(() => {
    try {
      return watchFile(
        { fileSystemId, fileId },
        { actor: "ui", permissions: [], intent: "watch" },
        () => setWatchRevision((value) => value + 1),
      )?.dispose
    } catch {
      return undefined
    }
  }, [fileId, fileSystemId, registryRevision])

  return state
}
