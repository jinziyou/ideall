"use client"

import * as React from "react"
import { fileRefKey, type FileRef } from "@protocol/file-system"
import {
  getFileSystemRevision,
  readFileDirectory,
  subscribeFileSystems,
  watchFile,
} from "@/filesystem/registry"
import type { FileSystemAccessContext } from "@/filesystem/types"
import {
  PagedDirectoryController,
  type PagedDirectoryControllerOptions,
  type PagedDirectoryGateway,
  type PagedDirectorySnapshot,
} from "./paged-directory"

const UI_DIRECTORY_CONTEXT = {
  actor: "ui",
  permissions: [],
  intent: "directory",
} as const satisfies FileSystemAccessContext

const UI_WATCH_CONTEXT = {
  actor: "ui",
  permissions: [],
  intent: "watch",
} as const satisfies FileSystemAccessContext

const registryPagedDirectoryGateway: PagedDirectoryGateway = {
  read: (ref, options) => readFileDirectory(ref, UI_DIRECTORY_CONTEXT, options),
  watch: (ref, notify) => watchFile(ref, UI_WATCH_CONTEXT, notify),
}

export type PagedDirectoryBinding = PagedDirectorySnapshot &
  Readonly<{
    loadMore(): Promise<boolean>
    reset(): Promise<boolean>
  }>

const LOADING_DIRECTORY_SNAPSHOT: PagedDirectorySnapshot = {
  pages: [],
  loading: true,
  loadingMore: false,
  error: null,
  resetVersion: 0,
}

type KeyedDirectorySnapshot = Readonly<{
  key: string
  snapshot: PagedDirectorySnapshot
}>

export function usePagedDirectory(
  directory: FileRef,
  options: Omit<PagedDirectoryControllerOptions, "seed"> = {},
): PagedDirectoryBinding {
  const key = fileRefKey(directory)
  const { fileSystemId, fileId } = directory
  const pageSize = options.pageSize
  const maxPages = options.maxPages
  const maxEntries = options.maxEntries
  const registryRevision = React.useSyncExternalStore(
    subscribeFileSystems,
    getFileSystemRevision,
    () => 0,
  )
  const [state, setState] = React.useState<KeyedDirectorySnapshot>(() => ({
    key,
    snapshot: LOADING_DIRECTORY_SNAPSHOT,
  }))
  const stateRef = React.useRef(state)
  const controllerRef = React.useRef<PagedDirectoryController | null>(null)

  React.useEffect(() => {
    const ref = { fileSystemId, fileId }
    const previous = stateRef.current
    const seed = previous.key === key ? previous.snapshot : undefined
    if (!seed) {
      const empty = { key, snapshot: LOADING_DIRECTORY_SNAPSHOT }
      stateRef.current = empty
      setState(empty)
    }
    const controller = new PagedDirectoryController(
      ref,
      registryPagedDirectoryGateway,
      (snapshot) => {
        if (controllerRef.current !== controller) return
        const next = { key, snapshot }
        stateRef.current = next
        setState(next)
      },
      { pageSize, maxPages, maxEntries, ...(seed ? { seed } : {}) },
    )
    controllerRef.current = controller
    void controller.start()
    return () => {
      if (controllerRef.current === controller) controllerRef.current = null
      controller.dispose()
    }
  }, [fileId, fileSystemId, key, maxEntries, maxPages, pageSize, registryRevision])

  const loadMore = React.useCallback(
    () => controllerRef.current?.loadMore() ?? Promise.resolve(false),
    [],
  )
  const reset = React.useCallback(
    () => controllerRef.current?.reset() ?? Promise.resolve(false),
    [],
  )
  const visibleState = state.key === key ? state.snapshot : LOADING_DIRECTORY_SNAPSHOT
  return { ...visibleState, loadMore, reset }
}
