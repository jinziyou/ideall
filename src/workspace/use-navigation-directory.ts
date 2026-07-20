"use client"

import * as React from "react"
import { type DirectoryEntry, type FileRef, type IdeallFile } from "@protocol/file-system"
import {
  getFileSystem,
  readFileDirectory,
  subscribeFileSystems,
  watchFile,
} from "@/filesystem/registry"
import {
  projectDirectoryEntryMetadata,
  resolveDirectoryEntryMetadata,
} from "@/filesystem/directory-metadata"
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

const EMPTY_STATE: NavigationDirectoryState = {
  items: [],
  loading: true,
  unavailable: false,
}

type CachedNavigationDirectory = Readonly<{
  provider: ReturnType<typeof getFileSystem>
  state: NavigationDirectoryState
}>

const directoryCache = new Map<string, CachedNavigationDirectory>()
const pendingReads = new Map<
  string,
  Readonly<{
    provider: ReturnType<typeof getFileSystem>
    promise: Promise<NavigationDirectoryState>
  }>
>()

function directoryKey(fileSystemId: string, fileId: string): string {
  return JSON.stringify([fileSystemId, fileId])
}

async function loadNavigationDirectory(
  fileSystemId: string,
  fileId: string,
  provider: ReturnType<typeof getFileSystem>,
  refresh: boolean,
): Promise<NavigationDirectoryState> {
  const key = directoryKey(fileSystemId, fileId)
  const cached = directoryCache.get(key)
  if (!refresh && cached?.provider === provider) return cached.state
  const inFlight = pendingReads.get(key)
  if (inFlight?.provider === provider) return inFlight.promise

  const ref = { fileSystemId, fileId }
  const promise = readAllDirectoryEntries((options) =>
    readFileDirectory(ref, { actor: "ui", permissions: [], intent: "directory" }, options),
  )
    .then(async (entries) => {
      const visible = entries.filter((entry) => entry.properties?.navigationHidden !== true)
      const items = await resolveDirectoryEntryMetadata(projectDirectoryEntryMetadata(visible), {
        actor: "ui",
        permissions: [],
        intent: "metadata",
      })
      return { items, loading: false, unavailable: false }
    })
    .catch((): NavigationDirectoryState => ({
      items: [],
      loading: false,
      unavailable: true,
    }))
    .then((state) => {
      if (getFileSystem(fileSystemId) === provider) {
        directoryCache.set(key, { provider, state })
      }
      return state
    })
    .finally(() => {
      if (pendingReads.get(key)?.promise === promise) pendingReads.delete(key)
    })
  pendingReads.set(key, { provider, promise })
  return promise
}

/** ActivityBar、桌面侧栏与移动抽屉共用的 FileSystem 目录读取边界。 */
export function useNavigationDirectory(directory: FileRef): NavigationDirectoryState {
  const { fileSystemId, fileId } = directory
  // Only the provider that owns this directory can invalidate its cache. Runtime extensions for
  // unrelated file systems must not reload all visible navigation controls.
  const providerSnapshot = React.useSyncExternalStore(
    subscribeFileSystems,
    () => getFileSystem(fileSystemId),
    () => getFileSystem(fileSystemId),
  )
  const [watchRevision, setWatchRevision] = React.useState(0)
  const key = directoryKey(fileSystemId, fileId)
  const cached = directoryCache.get(key)
  const initialState = cached?.provider === providerSnapshot ? cached.state : EMPTY_STATE
  const [result, setResult] = React.useState(() => ({ key, state: initialState }))
  const state = result.key === key ? result.state : initialState

  React.useEffect(() => {
    let active = true
    const prior = directoryCache.get(key)
    if (prior?.provider !== providerSnapshot) {
      setResult({ key, state: EMPTY_STATE })
    }
    void loadNavigationDirectory(fileSystemId, fileId, providerSnapshot, watchRevision > 0).then(
      (next) => {
        if (active) setResult({ key, state: next })
      },
    )
    return () => {
      active = false
    }
  }, [fileId, fileSystemId, key, providerSnapshot, watchRevision])

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
  }, [fileId, fileSystemId, providerSnapshot])

  return state
}
